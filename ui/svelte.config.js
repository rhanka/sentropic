import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
  kit: {
    adapter: adapter({
      // Generate 404.html as fallback for SPA routing on GitHub Pages
      fallback: '404.html'
    }),
    // Force des URLs d'actifs absolues (/_app/...) au lieu de chemins relatifs
    paths: {
      relative: false
    },
    prerender: {
      handleHttpError: 'warn',
      handleUnseenRoutes: 'ignore'
    }
  },
  preprocess: vitePreprocess()
};

export default config;
