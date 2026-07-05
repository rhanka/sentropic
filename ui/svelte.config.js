import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
  kit: {
    adapter: adapter({
      // Generate 404.html as fallback for SPA routing on GitHub Pages
      // This allows dynamic routes to work on refresh (GitHub Pages uses 404.html as fallback)
      fallback: '404.html'
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
  // `style: false` disables PostCSS preprocessing of <style> blocks. Tailwind is
  // applied to the global `src/app.css` (Vite runs postcss.config on it directly)
  // and none of ui/'s own .svelte files use <style lang=...>. The consumed
  // `@sentropic/auth-ui` + `@sentropic/design-system-svelte` ship plain scoped
  // <style> (and ThemeProvider's `{@html "<style>${css}</style>"}`) which Svelte
  // compiles natively; running the host tailwind/autoprefixer PostCSS over them
  // breaks (postcss "Unknown word css" on ThemeProvider's `${css}` literal). Mirrors
  // apps/auth-idp/web (the other DS host).
  preprocess: vitePreprocess({ style: false })
};

export default config;
