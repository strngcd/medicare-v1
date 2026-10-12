const bcrypt = require('bcrypt');
const config = require('../config');

// A real hash to compare against when the account does not exist, so the
// response time does not reveal whether an email is registered.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', config.security.bcryptRounds);

const PASSWORD_RULES = 'Password must be 8-128 characters and include at least one letter and one number.';

function isStrongPassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 8 &&
    password.length <= 128 &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password)
  );
}

function hashPassword(password) {
  return bcrypt.hash(password, config.security.bcryptRounds);
}

async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(String(password ?? ''), passwordHash || DUMMY_HASH);
}

module.exports = { hashPassword, verifyPassword, isStrongPassword, PASSWORD_RULES };
