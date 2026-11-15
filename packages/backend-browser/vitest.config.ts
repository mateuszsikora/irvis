import { defineProject } from 'vitest/config';
export default defineProject({
  test: { name: 'backend-browser', environment: 'jsdom', include: ['test/**/*.test.ts'] },
});
