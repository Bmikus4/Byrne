import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // The solver's determinism test compares bit patterns across runs; parallel workers
    // are fine (each run is independent) but a single thread keeps timings comparable.
    pool: 'threads',
    testTimeout: 30_000,
  },
})
