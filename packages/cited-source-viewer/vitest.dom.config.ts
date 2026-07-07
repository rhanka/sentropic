/**
 * vitest.dom.config.ts — jsdom harness for @sentropic/cited-source-viewer
 * frame/body component tests (mirrors chat-ui's BR-A0b-EX1 harness).
 *
 * Only *.dom.spec.ts files run through this config (jsdom + Svelte plugin).
 * The pure-engine tests run via `vitest run tests --environment node` with no
 * config file and are NOT affected.
 *
 * The design-system package ships preprocessed .svelte files in dist, so it
 * must be inlined/noExternal'd for the Svelte plugin to compile it at test
 * time (same pattern chat-ui uses for @lucide/svelte).
 */
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    svelte({
      // Remove the default node_modules exclusion so dependency .svelte files
      // (design-system dist) are Svelte-compiled.
      exclude: [],
    }),
  ],
  resolve: {
    // Force the browser/client conditions so Svelte's client build is used.
    conditions: ["browser", "module", "import", "default"],
  },
  ssr: {
    noExternal: [
      "@sentropic/design-system-svelte",
      "@sentropic/design-system-themes",
      "@lucide/svelte",
    ],
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.dom.spec.ts"],
    server: {
      deps: {
        inline: [
          /@sentropic\/design-system-svelte/,
          /@sentropic\/design-system-themes/,
          /@lucide\/svelte/,
        ],
      },
    },
  },
});
