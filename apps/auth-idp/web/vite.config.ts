import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// `@sentropic/auth-ui` is consumed from its workspace SOURCE via a relative
// `file:` symlink (apps/auth-idp/web is a self-contained sub-project, not a
// root workspace member). The peer `@simplewebauthn/browser` is aliased to this
// project's installed copy via `kit.alias` in svelte.config.js (one source of
// truth for both svelte-check and Vite); `svelte` is deduped here for safety.
export default defineConfig({
  plugins: [sveltekit()],
  base: '/',
  resolve: {
    dedupe: ['svelte', '@simplewebauthn/browser'],
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['auth-idp', 'localhost', '127.0.0.1', 'host.docker.internal'],
  },
});
