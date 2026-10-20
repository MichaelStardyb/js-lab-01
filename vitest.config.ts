import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'shared/vitest.config.ts',
      'server/vitest.config.ts',
      'client/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
      },
      include: ['shared/**/*.ts'],
      exclude: [
        '**/test/**',
        '**/*.test.ts',
        '**/*.config.ts',
        '**/dist/**',
        '**/node_modules/**',
      ],
    },
  },
});
