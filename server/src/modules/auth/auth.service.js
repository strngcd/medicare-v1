const config = require('../../config');
const AppError = require('../../errors/AppError');
const { withTransaction } = require('../../database/db');
const { generateToken, hashToken } = require('../../utils/crypto');
const { sendMail } = require('../../utils/mailer');
const { hashPassword, verifyPassword, isStrongPassword, PASSWORD_RULES } = require('../../auth/password');
const { createSession, revokeSession, revokeUserSessions } = require('../../auth/sessions');
const { loadAuthContext } = require('../../auth/authContext');
const { notifyUsers } = require('../notifications/notification.writer');
const repo = require('./auth.repository');

const INVALID_CREDENTIALS = () =>
  new AppError('INVALID_CREDENTIALS', 'The email or password is incorrect.', 401);

/**
 * Chooses the branch to open after login: the last selected branch if it is
 * still accessible and active, otherwise the first active assigned branch.
 * Owners default to "All Branches" (null).
 */
function selectInitialBranch(auth, branches) {
  const active = branches.filter((b) => b.status === 'ACTIVE');
  const last = active.find((b) => b.id === auth.lastSelectedBranchId);
  if (last) return last.id;
  if (auth.isOwner) return null;
  return active.length ? active[0].id : null;
}

/** The session payload returned by login and GET /auth/me. */
async function buildSessionPayload(auth) {
  const [profile, branches, settings] = await Promise.all([
    repo.findProfile(auth.userId),
    repo.listActiveBranchesForUser(auth.userId, auth.isOwner),
    repo.findPublicSettings(),
  ]);
  return {
    user: {
      id: profile.id,
      fullName: profile.full_name,
      email: profile.email,
      phone: profile.phone,
      employeeId: profile.employee_id,
      jobTitle: profile.job_title,
      lastLoginAt: profile.last_login_at,
      role: { code: auth.roleCode, name: auth.roleName },
    },
    permissions: [...auth.permissions].sort(),
    branches,
    canAccessAllBranches: auth.isOwner,
    selectedBranchId: selectInitialBranch(auth, branches),
    preferences: {
      theme: profile.theme,
      pageSize: profile.page_size,
      uiDensity: profile.ui_density,
    },
    pharmacy: {
      name: settings.pharmacy_name,
      logoUrl: settings.logo_url,
      currencyCode: settings.currency_code,
      expiryWarningDays: settings.expiry_warning_days,
      defaultMarkupPercent: settings.default_markup_percent,
      tax: {
        enabled: settings.tax_enabled,
        name: settings.tax_name,
        rate: settings.tax_rate,
        mode: settings.tax_mode,
      },
    },
  };
}

async function recordFailure(email, ctx, userId, failureCategory) {
  await withTransaction(async (client) => {
    await repo.recordLoginAttempt(email, ctx.ipAddress, false, client);
    await repo.recordLoginHistory(client, {
      userId,
      eventType: 'LOGIN',
      success: false,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      failureCategory,
    });
  });
}

async function login({ email, password }, ctx) {
  const { loginRateLimitMaxAttempts: maxAttempts, loginRateLimitWindowMinutes: windowMinutes } = config.security;

  const failures = await repo.countRecentFailures(email, ctx.ipAddress, windowMinutes);
  const user = await repo.findUserForLogin(email);

  if (failures.byEmail >= maxAttempts || failures.byIp >= maxAttempts * 5) {
    await repo.recordLoginHistory(undefined, {
      userId: user ? user.id : null,
      eventType: 'LOGIN',
      success: false,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      failureCategory: 'RATE_LIMITED',
    });
    throw AppError.rateLimited('Too many failed sign-in attempts. Please wait and try again.');
  }

  // Always run bcrypt, even for unknown emails, so timing reveals nothing.
  const passwordMatches = await verifyPassword(password, user ? user.password_hash : null);
  if (!user || !user.password_hash || !passwordMatches) {
    await recordFailure(email, ctx, user ? user.id : null, 'INVALID_CREDENTIALS');
    throw INVALID_CREDENTIALS();
  }

  if (user.status !== 'ACTIVE') {
    await recordFailure(email, ctx, user.id, 'ACCOUNT_INACTIVE');
    throw new AppError('ACCOUNT_INACTIVE', 'This account is inactive. Contact an administrator.', 403);
  }

  const auth = await loadAuthContext(user.id);
  const branches = await repo.listActiveBranchesForUser(user.id, auth.isOwner);
  const branchId = selectInitialBranch(auth, branches);

  const tokens = await withTransaction(async (client) => {
    const session = await createSession(client, {
      userId: user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    await repo.markLoggedIn(client, user.id, branchId);
    await repo.clearLoginFailures(email, client);
    await repo.recordLoginAttempt(email, ctx.ipAddress, true, client);
    await repo.recordLoginHistory(client, {
      userId: user.id,
      eventType: 'LOGIN',
      success: true,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      branchId,
    });
    return session;
  });

  auth.lastSelectedBranchId = branchId;
  return { tokens, payload: await buildSessionPayload(auth) };
}

async function logout(auth, ctx) {
  await withTransaction(async (client) => {
    await revokeSession(client, auth.sessionId, 'LOGOUT');
    await repo.recordLoginHistory(client, {
      userId: auth.userId,
      eventType: 'LOGOUT',
      success: true,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      branchId: auth.lastSelectedBranchId,
    });
  });
}

/**
 * Creates a single-use password link (reset or first-time setup) and returns
 * the raw token and URL. Only the hash is persisted.
 */
async function issuePasswordToken(client, { userId, purpose, createdBy }) {
  const token = generateToken(32);
  const ttlMs =
    purpose === 'ACCOUNT_SETUP'
      ? config.security.accountSetupTtlHours * 60 * 60 * 1000
      : config.security.passwordResetTtlMinutes * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);
  await repo.createPasswordToken(client, {
    userId,
    purpose,
    tokenHash: hashToken(token),
    expiresAt,
    createdBy,
  });
  const path = purpose === 'ACCOUNT_SETUP' ? 'setup-password' : 'reset-password';
  return { token, url: `${config.appBaseUrl}/${path}?token=${encodeURIComponent(token)}`, expiresAt };
}

/**
 * Always resolves the same way so the response never reveals whether the
 * email belongs to an account.
 */
async function forgotPassword({ email }) {
  const user = await repo.findUserForLogin(email);
  if (!user || user.status !== 'ACTIVE') return;
  if ((await repo.countRecentResetRequests(user.id)) >= 3) return;

  const link = await withTransaction((client) =>
    issuePasswordToken(client, { userId: user.id, purpose: 'PASSWORD_RESET' }),
  );
  await sendMail({
    to: email,
    subject: 'Reset your Medicar password',
    text:
      `A password reset was requested for your Medicar account.\n\n` +
      `Open this link to choose a new password (valid for ${config.security.passwordResetTtlMinutes} minutes, single use):\n` +
      `${link.url}\n\nIf you did not request this, you can ignore this email.`,
  });
}

/**
 * Completes a password reset or first-time account setup. Consumes the
 * token and signs the user out everywhere.
 */
async function resetPassword({ token, password }, ctx) {
  if (!isStrongPassword(password)) {
    throw AppError.validation(PASSWORD_RULES, { fields: { password: PASSWORD_RULES } });
  }

  const passwordHash = await hashPassword(password);
  const result = await withTransaction(async (client) => {
    const claimed = await repo.claimPasswordToken(client, hashToken(token));
    if (!claimed || claimed.status !== 'ACTIVE') return null;

    await repo.updatePasswordHash(client, claimed.user_id, passwordHash);
    await repo.markPasswordTokenUsed(client, claimed.id);
    await revokeUserSessions(client, claimed.user_id, 'PASSWORD_RESET');
    await notifyUsers(client, [claimed.user_id], {
      type: 'PASSWORD_RESET',
      title: claimed.purpose === 'ACCOUNT_SETUP' ? 'Account password set' : 'Password reset',
      message:
        claimed.purpose === 'ACCOUNT_SETUP'
          ? 'Your account password was set using your setup link.'
          : 'Your password was reset. All previous sessions were signed out.',
      entityType: 'USER',
      entityId: claimed.user_id,
    });
    return claimed;
  });

  if (!result) {
    await repo.recordLoginHistory(undefined, {
      userId: null,
      eventType: 'LOGIN',
      success: false,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      failureCategory: 'INVALID_RESET_FLOW',
    });
    throw AppError.badRequest('INVALID_RESET_TOKEN', 'This link is invalid or has expired. Request a new one.');
  }
}

async function changePassword(auth, { currentPassword, newPassword }) {
  const currentHash = await repo.findUserPasswordHash(auth.userId);
  if (!(await verifyPassword(currentPassword, currentHash))) {
    throw new AppError('INVALID_CURRENT_PASSWORD', 'The current password is incorrect.', 422, {
      fields: { currentPassword: 'The current password is incorrect.' },
    });
  }
  if (!isStrongPassword(newPassword)) {
    throw AppError.validation(PASSWORD_RULES, { fields: { newPassword: PASSWORD_RULES } });
  }
  if (await verifyPassword(newPassword, currentHash)) {
    throw AppError.validation('Choose a password different from the current one.', {
      fields: { newPassword: 'Choose a password different from the current one.' },
    });
  }

  const passwordHash = await hashPassword(newPassword);
  await withTransaction(async (client) => {
    await repo.updatePasswordHash(client, auth.userId, passwordHash);
    await revokeUserSessions(client, auth.userId, 'PASSWORD_CHANGED', auth.sessionId);
    await notifyUsers(client, [auth.userId], {
      type: 'PASSWORD_CHANGED',
      title: 'Password changed',
      message: 'Your password was changed. Other sessions were signed out.',
      entityType: 'USER',
      entityId: auth.userId,
    });
  });
}

module.exports = {
  login,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
  buildSessionPayload,
  issuePasswordToken,
  selectInitialBranch,
};
