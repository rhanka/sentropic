import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  cacheDir: '/tmp/sentropic-ui-vite-cache',
  plugins: [sveltekit()],
  base: '/',
  // Dedupe svelte + the DS packages so a single instance is bundled even though
  // `@sentropic/auth-ui` (which now renders native DS components) is consumed from
  // its workspace source — avoids duplicate Svelte runtime / DS theme contexts.
  resolve: {
    dedupe: ['svelte', '@sentropic/design-system-svelte', '@sentropic/design-system-themes']
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['ui', 'localhost', '127.0.0.1', 'host.docker.internal']
  }
});
