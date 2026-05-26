import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built assets are served by the Next.js app under /addins/word/ (see
// next.config.ts `rewrites`). `base` must match so the asset URLs in the
// generated HTML resolve when Office loads the task pane.
export default defineConfig({
  plugins: [react()],
  base: '/addins/word/',
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
    port: 5102,
  },
});
