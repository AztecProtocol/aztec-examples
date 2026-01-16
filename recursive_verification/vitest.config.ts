import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 600000, // 10 minutes - proof generation/verification can take several minutes
    hookTimeout: 600000, // 10 minutes for beforeAll/afterAll hooks
  },
})
