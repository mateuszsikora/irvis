import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'capture-cli',
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // The report tests build, gzip and read back synthetic 256x384 captures.
    testTimeout: 60_000,
  },
});
