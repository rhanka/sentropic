import path from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, '../src/lib'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: false,
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      input: path.resolve(__dirname, 'webview-entry.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'webview-entry.js',
        inlineDynamicImports: true,
      },
    },
  },
});
