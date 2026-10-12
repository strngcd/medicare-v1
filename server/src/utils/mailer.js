const nodemailer = require('nodemailer');
const config = require('../config');

// In tests, messages are captured here instead of being delivered.
const testOutbox = [];

let transport = null;
function getTransport() {
  if (!transport && config.smtp.host) {
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
    });
  }
  return transport;
}

/**
 * Sends an email. Without SMTP configuration, development prints the message
 * to the server console so links can be used locally. Delivery failures are
 * logged but never break the calling request (and never reveal whether an
 * account exists).
 */
async function sendMail({ to, subject, text }) {
  if (config.isTest) {
    testOutbox.push({ to, subject, text });
    return;
  }
  const smtp = getTransport();
  if (!smtp) {
    console.log(`\n[mail] To: ${to}\n[mail] Subject: ${subject}\n${text}\n`);
    return;
  }
  try {
    await smtp.sendMail({ from: config.smtp.from, to, subject, text });
  } catch (err) {
    console.error('[mail] Delivery failed:', err.message);
  }
}

module.exports = { sendMail, testOutbox };
