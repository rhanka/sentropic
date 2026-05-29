/**
 * esbuild bundle config for the Sentropic Cowork single-exe.
 *
 * Bundles `packaging/entry.mjs` (which pulls in `../src/index.ts` +
 * `@sentropic/cowork-bridge` + `@sentropic/chat-ui`) into ONE CommonJS file
 * targeting Node 24. CJS (not ESM) is required because the downstream packager
 * (@yao-pkg/pkg) snapshots a CJS entry into the Node bootstrap.
 *
 * The native capture/input modules are kept EXTERNAL: they ship as real
 * Windows prebuilds next to the exe and are loaded at runtime via the dynamic
 * `import()` calls in `windows-provider.ts`. Bundling them would defeat that.
 */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, '..');

// Native single-exe-incompatible modules: loaded at runtime from disk, never bundled.
const NATIVE_EXTERNALS = ['screenshot-desktop', '@nut-tree-fork/nut-js'];

const outfile = resolve(packageRoot, 'build', 'cowork.bundle.cjs');

await build({
    entryPoints: [resolve(__dirname, 'entry.mjs')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    outfile,
    minify: false,
    sourcemap: false,
    // Resolve TS sources directly (the bridge/chat-ui expose .ts in `exports`).
    resolveExtensions: ['.ts', '.mjs', '.js', '.json'],
    // Keep native, runtime-loaded modules out of the bundle.
    external: NATIVE_EXTERNALS,
    // Banner: a guard so a stray bundling of the native libs surfaces clearly at
    // runtime rather than as an opaque module-not-found inside the snapshot.
    logLevel: 'info',
});

process.stdout.write(`esbuild: bundled single entry -> ${outfile}\n`);
