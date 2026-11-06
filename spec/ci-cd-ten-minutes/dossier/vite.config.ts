import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';
const diagram = (name: string) => path.resolve(`node_modules/.ci-diagram-source/packages/${name}/src/index.ts`);
export default defineConfig({
  base: './', plugins: [svelte()],
  resolve: { alias: { '@sentropic/diagram-core': diagram('diagram-core'), '@sentropic/diagram-canvas': diagram('diagram-canvas') },
    dedupe: ['svelte', '@sentropic/design-system-svelte', '@sentropic/design-system-themes'] },
  build: { target: 'es2022' },
});
