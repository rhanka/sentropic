import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // vitePreprocess() is used by the DOM test environment (@sveltejs/vite-plugin-svelte).
  // For the npm dist build, the Makefile build-chat-ui target temporarily replaces this
  // config with a svelte-preprocess-based one that strips TypeScript from <script lang="ts">.
  preprocess: vitePreprocess()
};

export default config;
