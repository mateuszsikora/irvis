import { defineProject } from 'vitest/config';
export default defineProject({
  test: { name: 'backend-replay', environment: 'jsdom', include: ['test/**/*.test.ts'] },
});
