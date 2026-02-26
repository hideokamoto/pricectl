const baseConfig = require('../../jest.config');

module.exports = {
  ...baseConfig,
  displayName: 'core',
  rootDir: '.',
  testPathIgnorePatterns: ['/__tests__/helpers\\.ts$'],
};
