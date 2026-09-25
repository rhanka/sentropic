import { defineConfig } from 'vitest/config';

// Keep the Vite cache out of the bind-mounted workspace (container-owned files).
export default defineConfig({
  cacheDir: '/tmp/llm-gateway-host-vitest',
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
