module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/helpers/env.js'],
  globalSetup: '<rootDir>/tests/helpers/globalSetup.js',
  testTimeout: 20000,
};
