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
      'tests/unit/**/*.test.tsx',
    ],
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/core/**/*.ts'],
      // Core-only CI baseline: 82.29 / 72.86 / 85.96 / 83.25 (2026-09-13).
      // Keep a small margin for platform-specific execution; never lower these to fix a failing build.
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 83,
        lines: 81,
      },
      exclude: [
        'src/core/**/*.test.ts',
        'src/core/index.ts',
        'src/core/**/index.ts'
      ],
      reportsDirectory: './coverage'
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['default'],
    pool: 'forks'
  }
});
