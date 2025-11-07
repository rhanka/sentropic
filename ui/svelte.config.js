import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
  kit: {
    adapter: adapter({
      // Generate 404.html as fallback for SPA routing on GitHub Pages
      // fallback: '404.html' // Disabled during build to avoid redirect issues
      fallback: undefined
    }),
    // Force des URLs d'actifs absolues (/_app/...) au lieu de chemins relatifs
    paths: {
      relative: false
    },
    prerender: {
      handleHttpError: 'warn',
      handleUnseenRoutes: 'ignore',
      handleMissingId: 'warn'
    }
  },
  preprocess: vitePreprocess()
};

export default config;
