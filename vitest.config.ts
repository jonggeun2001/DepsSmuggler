import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/core/**/*.ts'],
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
