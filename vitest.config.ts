import { defineConfig } from 'vitest/config';

// One Vitest project per package; each package's own config names it and
// picks its environment. How to run and add tests: docs/guides/testing.md
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
