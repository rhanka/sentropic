import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const maxForks = process.env.VITEST_MAX_WORKERS
  ? Number(process.env.VITEST_MAX_WORKERS)
  : undefined;

const pkgSrc = (name: string, entry = 'index.ts'): string =>
  fileURLToPath(new URL(`../packages/${name}/src/${entry}`, import.meta.url));

export default defineConfig({
  cacheDir: '/tmp/sentropic-api-vitest-cache',
  // Resolve the connector-host stack workspace packages from their TypeScript source,
  // so the api unit tests do not depend on a pre-built dist entry (which vite's package
  // entry resolver cannot always locate for a file: workspace dep). Runtime/app builds
  // still consume the published package entry — this alias is test-only.
  resolve: {
    alias: {
      '#mcp-platform-hono': pkgSrc('mcp-platform', 'hono.ts'),
      '@sentropic/comments/hono': pkgSrc('comments', 'hono.ts'),
      '@sentropic/connector-host/hono': pkgSrc('connector-host', 'hono.ts'),
      '@sentropic/flow/hono': pkgSrc('flow', 'hono.ts'),
      '@sentropic/focus/hono': pkgSrc('focus', 'hono.ts'),
      '@sentropic/focus/track': pkgSrc('focus', 'track/index.ts'),
      '@sentropic/llm-mesh/hono': pkgSrc('llm-mesh', 'hono.ts'),
      '@sentropic/mcp-auth/hono': pkgSrc('mcp-auth', 'hono.ts'),
      '@sentropic/mcp-platform/hono': pkgSrc('mcp-platform', 'hono.ts'),
      '@sentropic/auth-client': pkgSrc('auth-client'),
      '@sentropic/auth-hono': pkgSrc('auth-hono'),
      '@sentropic/chat-core': pkgSrc('chat-core'),
      '@sentropic/chat-server': pkgSrc('chat-server'),
      '@sentropic/cluster-mesh': pkgSrc('cluster-mesh'),
      '@sentropic/comments': pkgSrc('comments'),
      '@sentropic/connector-host': pkgSrc('connector-host'),
      '@sentropic/contracts': pkgSrc('contracts'),
      '@sentropic/events': pkgSrc('events'),
      '@sentropic/flow': pkgSrc('flow'),
      '@sentropic/focus': pkgSrc('focus'),
      '@sentropic/llm-mesh': pkgSrc('llm-mesh'),
      '@sentropic/mcp-auth': pkgSrc('mcp-auth'),
      '@sentropic/mcp-connector-google': pkgSrc('mcp-connector-google'),
      '@sentropic/mcp-platform': pkgSrc('mcp-platform'),
      '@sentropic/oauth-verify': pkgSrc('oauth-verify'),
      '@sentropic/skills': pkgSrc('skills'),
      '@sentropic/ubo-contracts': pkgSrc('ubo-contracts'),
    },
  },
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        // Keep minForks bounded when maxForks is forced via env to avoid Tinypool conflicts.
        ...(maxForks !== undefined ? { minForks: 1, maxForks } : {}),
      }
    },
    // Increase timeout for database operations and AI API calls
    testTimeout: 60000,
    hookTimeout: 60000,
    // Setup files
    setupFiles: [],
  },
});
