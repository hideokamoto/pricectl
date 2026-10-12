/**
 * End-to-end tests against Stripe test mode. They need STRIPE_SECRET_KEY (a test-mode key) and
 * are not part of `pnpm test`: run them with `pnpm test:e2e`, in CI only.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/*.e2e.test.ts'],
  testTimeout: 120000,
  moduleNameMapper: {
    '^@pricectl/core$': '<rootDir>/../../packages/core/src',
    '^@pricectl/constructs$': '<rootDir>/../../packages/constructs/src',
    '^stripe$': '<rootDir>/../../packages/cli/node_modules/stripe',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};
