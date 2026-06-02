import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The backend base URL is injected at build/dev time via VITE_API_BASE_URL
// (see .env.example), aligned with the api service port.
export default defineConfig({
  plugins: [svelte()],
  server: {
    host: '0.0.0.0',
    port: {{ui_port}},
  },
  preview: {
    host: '0.0.0.0',
    port: {{ui_port}},
  },
});
