import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'docs-check',
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Each test copies the repository into a temporary git repository and
    // runs the check there, some several times.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
