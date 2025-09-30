import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
  kit: {
    adapter: adapter(),
    prerender: {
      handleHttpError: 'warn'
    }
  },
  preprocess: vitePreprocess()
};

export default config;
