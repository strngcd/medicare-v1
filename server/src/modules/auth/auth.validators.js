const { z, email } = require('../../validators/common');

const loginBody = z.object({
  email,
  password: z.string().min(1, 'Password is required.').max(128),
});

const forgotPasswordBody = z.object({ email });

const resetPasswordBody = z.object({
  token: z.string().min(20).max(200),
  password: z.string().max(128),
});

const changePasswordBody = z.object({
  currentPassword: z.string().min(1, 'Current password is required.').max(128),
  newPassword: z.string().max(128),
});

module.exports = { loginBody, forgotPasswordBody, resetPasswordBody, changePasswordBody };
