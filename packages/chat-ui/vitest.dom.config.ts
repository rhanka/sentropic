/**
 * vitest.dom.config.ts — jsdom harness for @sentropic/chat-ui DOM/ARIA tests.
 *
 * This config is ONLY active for *.dom.spec.ts files (jsdom environment).
 * The existing node-environment tests run via `vitest run tests --environment node`
 * (no config file — vitest's default inline env override) and are NOT affected.
 *
 * BR-A0b-EX1: requires @sveltejs/vite-plugin-svelte + vite + jsdom +
 * @testing-library/svelte@5 + @lucide/svelte (added as dev-deps
 * in the test-chat-ui-dom Makefile target, NOT in package.json devDependencies).
 *
 * BR-CONV-EX1: adds svelte-streamdown to ephemeral install and noExternal/inline
 * so StreamMessage (which imports Streamdown from svelte-streamdown) compiles
 * correctly in the jsdom environment.
 *
 * Spike findings (iterative):
 * 1. "rune_outside_svelte": @testing-library/svelte-core/props.svelte.js was not
 *    transformed. Fix: server.deps.inline + ssr.noExternal.
 * 2. "lifecycle_function_unavailable - mount not available on server": Svelte resolved
 *    the SSR build. Fix: resolve.conditions = ['browser', ...].
 * 3. "@lucide/svelte icons resolve to .svelte files": @lucide/svelte has an "Icon.svelte"
 *    component at its root + icons in dist/icons/*.svelte. The vite-plugin-svelte
 *    (exclude: []) handles these; alias forces .js resolution for dist icons.
 */
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    svelte({
      // Remove the default node_modules exclusion so that
      // @testing-library/svelte-core/src/props.svelte.js is Svelte-compiled.
      exclude: [],
    }),
  ],
  resolve: {
    // Force the browser/module conditions so Svelte's client build is used
    // (not index-server.js) even when ssr.noExternal is set.
    // IMPORTANT: do NOT include "svelte" condition here to avoid @lucide/svelte
    // resolving to .svelte source files that require additional compilation.
    conditions: ['browser', 'module', 'import', 'default'],
  },
  ssr: {
    // Force these packages to be bundled through vite (not treated as external),
    // so the Svelte plugin can transform props.svelte.js at test time.
    // BR-CONV-EX1: svelte-streamdown added — StreamMessage imports Streamdown from it.
    noExternal: [
      '@testing-library/svelte',
      '@testing-library/svelte-core',
      '@lucide/svelte',
      'svelte-streamdown',
    ],
  },
  test: {
    // jsdom environment for DOM/ARIA tests
    environment: 'jsdom',
    // Only run *.dom.spec.ts files through this config
    include: ['tests/**/*.dom.spec.ts'],
    server: {
      deps: {
        // Inline these packages so vitest processes them through vite transforms
        // (the Svelte plugin must compile .svelte and .svelte.js files from these).
        // BR-CONV-EX1: svelte-streamdown inlined so StreamMessage compiles cleanly.
        inline: [/@testing-library\/svelte/, /@lucide\/svelte/, /svelte-streamdown/],
      },
    },
  },
});
