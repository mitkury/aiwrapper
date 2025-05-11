import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['tests-old/**/*'],
    globals: true,
    testTimeout: 30000, // 30 seconds timeout
    setupFiles: ['./tests/setup.js'] // Setup file to load environment variables
  }
});
