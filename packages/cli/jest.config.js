const baseConfig = require('../../jest.config');

module.exports = {
  ...baseConfig,
  displayName: 'cli',
  rootDir: '.',
  moduleNameMapper: {
    '^@pricectl/core$': '<rootDir>/../core/src',
    '^@pricectl/constructs$': '<rootDir>/../constructs/src',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
};
