import { defineConfig } from 'vitest/config'
import { testDatabaseUrl } from './src/integration/database-url.ts'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/integration/**/*.test.ts'],
    globalSetup: ['src/integration/global-setup.ts'],
    env: { DATABASE_URL: testDatabaseUrl(), NODE_ENV: 'test' },
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
})
