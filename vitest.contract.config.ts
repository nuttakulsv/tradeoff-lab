import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['contract/**/*.contract.ts'],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
