// Single-file build for publishing inside Claude (no module scripts, no font files).
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-artifact',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'index.html'),
      output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: '[name][extname]' },
    },
  },
});
