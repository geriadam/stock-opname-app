import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup-env.ts'],
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
