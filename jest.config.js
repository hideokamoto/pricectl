module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Jest sizes its worker pool from the host's CPU count. On CI the host reports more cores
  // than the container is allowed to use, and each ts-jest worker holds a TypeScript program,
  // so the default pool exhausts the container's memory. Two workers keep the peak low.
  maxWorkers: 2,
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
};
