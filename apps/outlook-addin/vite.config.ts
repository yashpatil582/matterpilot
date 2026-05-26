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
  },
});
