import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,ts}'],
    exclude: ['tests-old/**/*'],
    globals: true,
    testTimeout: 1000 * 60 * 5, // 5 minutes timeout
    setupFiles: ['./tests/setup.js'] // Setup file to load environment variables
  },
  resolve: {
    alias: {
      'aiwrapper': path.resolve(__dirname, 'dist/index.js')
    }
  },
  esbuild: {
    target: 'es2017'
  }
});
