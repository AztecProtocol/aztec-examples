import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 1200000, // 20 minutes - real IVC proof generation can be very slow
    hookTimeout: 1200000, // 20 minutes for beforeAll/afterAll hooks
  },
})
