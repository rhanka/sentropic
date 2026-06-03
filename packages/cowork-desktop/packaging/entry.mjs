/**
 * Packaging entry for the single Windows .exe.
 *
 * Imports the shared `runCli()` from `../src/index.ts` (instead of `../dist`)
 * so esbuild bundles the whole library + `@sentropic/cowork-bridge` +
 * `@sentropic/chat-ui` into one self-contained CJS file. Behaviorally identical
 * to `bin/cowork.mjs` by construction (both call the same `runCli`). The
 * optional native capture/input modules are kept EXTERNAL by the esbuild config
 * and resolved at runtime from the extracted cache (see `windows-provider.ts`).
 */

import { runCli } from '../src/index.ts';

runCli().catch((error) => {
    process.stderr.write(`fatal: ${error?.message ?? error}\n`);
    process.exitCode = 1;
});
