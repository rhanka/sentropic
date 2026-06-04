import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  plugins: [sveltekit()],
  base: '/',
  resolve: {
    // Keep the app consuming raw @sentropic/chat-ui source (not the published dist),
    // so the app's own vitePreprocess handles .svelte files exactly as before.
    // The exports→dist change is invisible to the app thanks to this alias.
    alias: [
      {
        find: /^@sentropic\/chat-ui(.*)/,
        replacement: `${path.resolve(__dirname, '../packages/chat-ui/src')}$1`
      }
    ]
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['ui', 'localhost', '127.0.0.1', 'host.docker.internal']
  }
});
