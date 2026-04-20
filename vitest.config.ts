import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'electron/**/*.test.ts',
      'tests/unit/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx', 'electron/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/core/**/*.test.ts',
        'src/core/index.ts',
        'src/core/**/index.ts',
        'src/**/*.d.ts',
        'src/types/**/*',
      ],
      thresholds: {
        lines: 40,
      },
      reportsDirectory: './coverage',
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['default'],
    pool: 'forks',
  },
});
