import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    dedupe: ['svelte', '@sentropic/design-system-svelte', '@sentropic/design-system-themes']
  },
  ssr: {
    noExternal: ['@sentropic/design-system-svelte', '@sentropic/design-system-themes']
  },
  build: { target: 'es2022' }
});
