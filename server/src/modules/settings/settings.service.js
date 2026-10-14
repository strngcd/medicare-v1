const { withTransaction } = require('../../database/db');
const config = require('../../config');
const { recordAudit, diff } = require('../audit/audit.recorder');
const { notifyUsers } = require('../notifications/notification.writer');
const { camelize } = require('../../utils/camelize');
const { businessToday } = require('../../utils/time');
const { PREFIXES } = require('../documents/documentNumbers');
const { version } = require('../../../package.json');
const AppError = require('../../errors/AppError');
const files = require('../files/files');
const repo = require('./settings.repository');

const TAX_FIELDS = ['taxEnabled', 'taxName', 'taxRate', 'taxMode'];

function toDto(row) {
  const dto = camelize(row);
  dto.taxRate = Number(row.tax_rate).toFixed(3);
  return dto;
}

async function getSettings() {
  return toDto(await repo.get());
}

async function updateSettings(auth, actor, changes) {
  return withTransaction(async (client) => {
    const before = toDto(await repo.get(client, { forUpdate: true }));
    const normalized = { ...changes };
    if (normalized.taxRate !== undefined) normalized.taxRate = Number(normalized.taxRate).toFixed(3);
    const { previous, next, changed } = diff(before, normalized, Object.keys(normalized));
    if (!changed) return before;

    await repo.update(client, changes, auth.userId);
    await recordAudit(client, actor, {
      action: 'SETTINGS_UPDATED',
      entityType: 'SYSTEM_SETTINGS',
      description: `Pharmacy settings updated (${Object.keys(next).join(', ')})`,
      previousValues: previous,
      newValues: next,
    });

    // Tax changes affect every new sale: tell the administrators.
    const taxChanged = Object.keys(next).filter((k) => TAX_FIELDS.includes(k));
    if (taxChanged.length) {
      await notifyUsers(client, await repo.listAdministrators(client, auth.userId), {
        type: 'IMPORTANT_CONFIGURATION_CHANGE',
        title: 'Tax settings changed',
        message: `${actor.userId === auth.userId ? auth.fullName : 'An administrator'} changed tax settings. New sales use the new configuration; past sales are unchanged.`,
        entityType: 'SYSTEM_SETTINGS',
      });
    }
    return toDto(await repo.get(client));
  });
}

/** Replaces (file) or removes (null) the pharmacy logo. */
async function setLogo(auth, actor, file) {
  return withTransaction(async (client) => {
    const before = await repo.get(client, { forUpdate: true });
    if (!file && !before.logo_file_id) return toDto(before);
    const stored = file ? await files.insertFile(client, file, auth.userId) : null;
    await repo.setLogo(client, stored ? stored.id : null, auth.userId);
    await recordAudit(client, actor, {
      action: 'SETTINGS_UPDATED',
      entityType: 'SYSTEM_SETTINGS',
      description: stored ? `Pharmacy logo uploaded (${stored.file_name})` : 'Pharmacy logo removed',
      previousValues: { logoFileId: before.logo_file_id },
      newValues: { logoFileId: stored ? stored.id : null },
    });
    return toDto(await repo.get(client));
  });
}

/** The current logo file, for the public branding endpoint. */
async function getLogo() {
  const settings = await repo.get();
  const file = settings.logo_file_id ? await files.findFile(settings.logo_file_id) : null;
  if (!file) throw AppError.notFound('No logo has been uploaded.');
  return file;
}

/** Non-sensitive system facts only (no infrastructure details or secrets). */
async function getSystemInfo() {
  const info = await repo.systemInfo();
  return {
    application: 'Medicar Pharmacy Management',
    version,
    environment: config.isProduction ? 'production' : config.env,
    businessTimezone: config.businessTimezone,
    businessDate: businessToday(),
    serverTime: new Date().toISOString(),
    schemaVersion: info.latestMigration ? info.latestMigration.name : null,
    counts: camelize(info.counts),
    numbering: {
      format: 'PREFIX-CODE, where CODE is 6 random letters and digits (non-sequential, never reused)',
      prefixes: PREFIXES,
      latestNumbers: camelize(info.latestNumbers),
    },
  };
}

/** Public branding for signed-out pages: name and logo only. */
async function getBranding() {
  const settings = await repo.get();
  return { pharmacyName: settings.pharmacy_name, logoUrl: settings.logo_url };
}

module.exports = { getSettings, updateSettings, setLogo, getLogo, getSystemInfo, getBranding };
