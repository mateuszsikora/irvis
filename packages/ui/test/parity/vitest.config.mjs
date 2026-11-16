import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/ui/test/parity/*.integration.mjs'],
    testTimeout: 180000,
    hookTimeout: 60000,
  },
});
