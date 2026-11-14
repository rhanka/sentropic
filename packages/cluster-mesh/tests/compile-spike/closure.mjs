import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

// Bundling is analysis only: the preview serves the published modules unchanged.
const result = await build({ entryPoints: ['@sentropic/design-system-vue'],
  absWorkingDir: '/tools', bundle: true, write: false, metafile: true,
  platform: 'browser', format: 'esm', treeShaking: false, external: ['vue', 'vue/vapor'] });
const inputs = Object.entries(result.metafile.inputs).map(([path, value]) => ({ path, bytes: value.bytes }));
const runtime = readFileSync('/tools/node_modules/vue/dist/vue.runtime-with-vapor.esm-browser.js');
const evidence = { package: '@sentropic/design-system-vue@0.39.0',
  N: 1, clock: 'not a duration; exact file and byte inventory from esbuild metafile',
  closureFiles: inputs.length + 1, closureBytes: inputs.reduce((sum, file) => sum + file.bytes, runtime.length),
  extraShellFiles: 3, ceilingFiles: 255, ceilingBytes: 64 * 1024 * 1024, inputs };
writeFileSync('/tools/spike/closure.json', JSON.stringify(evidence));
console.log(JSON.stringify({ ...evidence, inputs: undefined }));
