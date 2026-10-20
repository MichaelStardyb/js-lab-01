import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    name: 'client',
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    exclude: ['**/dist/**', '**/node_modules/**'],
  },
  resolve: {
    alias: {
      shared: resolve(import.meta.dirname, '../shared'),
    },
  },
});
