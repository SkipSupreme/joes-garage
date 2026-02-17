import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    pool: 'forks',
    globalSetup: ['src/__tests__/global-setup.ts'],
    teardownTimeout: 10_000,
    env: {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5434/joes_garage_test',
    },
  },
});
