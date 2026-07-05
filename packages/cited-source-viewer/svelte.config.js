import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/**
 * vitePreprocess() is used by the DOM test environment
 * (@sveltejs/vite-plugin-svelte). The package's .svelte sources are plain-JS
 * script blocks (no lang="ts"), so no TS-stripping publish step is required
 * (unlike chat-ui's BR-PKG-EX1 dance).
 */
const config = {
  preprocess: vitePreprocess(),
};

export default config;
