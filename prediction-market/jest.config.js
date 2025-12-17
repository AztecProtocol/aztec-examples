export default {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest'],
    '^.+\\.mjs$': ['@swc/jest'],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@aztec|ohash|fake-indexeddb)/)',
  ],
  testMatch: ['**/tests/**/*.test.ts'],
  testTimeout: 120000,
  verbose: true,
};
