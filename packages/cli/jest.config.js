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
    ...baseConfig.transform,
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  testPathIgnorePatterns: ['/__tests__/helpers/', '/__tests__/fixtures/'],
};
