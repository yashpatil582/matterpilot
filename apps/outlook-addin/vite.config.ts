import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The built assets are served by the Next.js app under /addins/outlook/
// (see next.config.ts `rewrites`). The `base` here MUST match that path so
// the bundled <script src=…> / <link href=…> URLs resolve when Office
// loads the task pane from the deployed origin.
export default defineConfig({
  plugins: [react()],
  base: '/addins/outlook/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        taskpane: 'index.html',
      },
    },
  },
  server: {
    port: 5101,
    proxy: {
      // In dev the Vite server serves the React shell at localhost:5101 and
      // forwards /api/* to the Next.js dev server (localhost:3000) so the
      // browser-side fetch('/api/addins/...') call works without CORS hops.
      '/api': 'http://localhost:3000',
    },
  },
});
