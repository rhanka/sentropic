#!/usr/bin/env node
/**
 * Thin Sentropic Cowork binary entry (npm `bin`).
 *
 * All lifecycle logic lives in the built library (`../dist/index.js`, produced
 * by `tsc -p tsconfig.json`); this wrapper just invokes the shared `runCli()`
 * so it can never drift from the packaged `packaging/entry.mjs`.
 */

import { runCli } from '../dist/index.js';

runCli().catch((error) => {
    process.stderr.write(`fatal: ${error?.message ?? error}\n`);
    process.exitCode = 1;
});
