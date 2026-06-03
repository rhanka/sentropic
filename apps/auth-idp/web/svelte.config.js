import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// BR-39m A0-bis — minimal IdP screens front.
// adapter-static + SPA fallback so the served bundle exposes the exact
// path-based routes the @sentropic/auth-hono authorize handler redirects to
// (loginUrl=/auth/login, consentUrl=/auth/oauth/consent). `paths.relative=false`
// forces absolute /_app asset URLs so the Hono static-serve works at any depth.
const config = {
  kit: {
    adapter: adapter({
      fallback: '404.html'
    }),
    // `@sentropic/auth-ui` is consumed from its workspace SOURCE via a relative
    // `file:` symlink (web is a self-contained sub-project, not a workspace
    // member), so its peer `@simplewebauthn/browser` is not resolvable from the
    // auth-ui source path. Alias it to THIS project's installed copy for both
    // svelte-check and the Vite build (one source of truth, no tsconfig paths).
    alias: {
      '@simplewebauthn/browser': './node_modules/@simplewebauthn/browser'
    },
    paths: {
      relative: false
    },
    prerender: {
      handleHttpError: 'warn',
      handleMissingId: 'warn'
    }
  },
  preprocess: vitePreprocess()
};

export default config;
