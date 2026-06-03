// BR-39m A0-bis — IdP screens are a client-rendered SPA served as static files
// by the IdP Hono service. Disable SSR/prerender of dynamic auth pages; the
// adapter-static fallback (404.html) handles path-based SPA routing.
export const ssr = false;
export const prerender = false;
