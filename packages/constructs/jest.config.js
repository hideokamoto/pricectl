const baseConfig = require('../../jest.config');

module.exports = {
  ...baseConfig,
  displayName: 'constructs',
  rootDir: '.',
  moduleNameMapper: {
    '^@pricectl/core$': '<rootDir>/../core/src',
  },
  transform: {
    ...baseConfig.transform,
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  testPathIgnorePatterns: ['/__tests__/helpers\\.ts$'],
};
