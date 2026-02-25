const baseConfig = require('../../jest.config');

module.exports = {
  ...baseConfig,
  displayName: 'constructs',
  rootDir: '.',
  moduleNameMapper: {
    '^@pricectl/core$': '<rootDir>/../core/src',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
};
