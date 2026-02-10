/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/restore.ts',
    '!src/save.ts',
    '!src/restore-only.ts',
    '!src/save-only.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 30,
      functions: 50,
      lines: 60,
      statements: 60
    }
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true
};
