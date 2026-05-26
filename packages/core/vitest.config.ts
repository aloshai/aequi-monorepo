import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Only run tests under src/. dist/ is the compiled output of `tsc`; if
    // we include it, vitest re-runs identical tests *and* keeps executing
    // stale tests for files that have been deleted from src/ (since the
    // dist artefacts persist until the next clean build).
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['dist/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['dist', 'node_modules', '**/*.spec.ts', '**/*.test.ts'],
    },
  },
})
