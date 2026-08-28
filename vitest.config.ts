import { defineConfig } from 'vitest/config'

// Client tests only. The backend has its own vitest run (npm --prefix backend test).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
