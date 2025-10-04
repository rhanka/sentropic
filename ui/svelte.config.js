import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
  kit: {
    adapter: adapter(),
    prerender: {
      handleHttpError: 'warn',
      handleUnseenRoutes: 'ignore'
    }
  },
  preprocess: vitePreprocess()
};

export default config;
