import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const maxForks = process.env.VITEST_MAX_WORKERS
  ? Number(process.env.VITEST_MAX_WORKERS)
  : undefined;

const pkgSrc = (name: string): string =>
  fileURLToPath(new URL(`../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  // Resolve the connector-host stack workspace packages from their TypeScript source,
  // so the api unit tests do not depend on a pre-built dist entry (which vite's package
  // entry resolver cannot always locate for a file: workspace dep). Runtime/app builds
  // still consume the published package entry — this alias is test-only.
  resolve: {
    alias: {
      '@sentropic/connector-host': pkgSrc('connector-host'),
      '@sentropic/mcp-connector-google': pkgSrc('mcp-connector-google'),
      '@sentropic/mcp-platform': pkgSrc('mcp-platform'),
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
