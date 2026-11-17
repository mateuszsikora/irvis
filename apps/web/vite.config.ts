import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// A relative base, so that the same files load from GitHub Pages under
// /irvis/ (or a custom domain's root) and from app://irvis/ in the desktop
// app: docs/features/web-app-technical.md#build
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The bundle drops the licence comments of the packages it contains;
    // this file carries their licence texts instead.
    license: { fileName: 'THIRD-PARTY-LICENSES.md' },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
