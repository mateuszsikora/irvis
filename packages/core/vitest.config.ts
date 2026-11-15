import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'core',
    environment: 'node',
    // Functional checks must tolerate contention on the shared CI runner.
    // Performance targets belong to the non-gating benchmarks.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
