import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// base '/' because Netlify and Electron (app://irvis/) both serve the build
// from the root: docs/features/web-app-technical.md#build
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
