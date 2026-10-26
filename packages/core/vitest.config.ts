import { defineConfig } from 'vitest/config';

const isCI = Boolean(process.env.CI);

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    // Run everything; never bail on the first failure.
    bail: 0,
    reporters: isCI ? ['default', 'junit', 'github-actions'] : ['default'],
    outputFile: { junit: 'reports/junit.xml' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/**/__tests__/**', 'src/**/*.d.ts'],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      // Still produce coverage reports when tests fail (fail-at-end).
      reportOnFailure: true,
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
