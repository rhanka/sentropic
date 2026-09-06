/**
 * `@sentropic/build-cli` public entry point.
 *
 * BR-42a1: the deterministic templating substrate (R10) + the pure generator core, behind
 * interfaces designed for later `@sentropic/harness` adoption (R5), plus the `stp app`
 * command layer (`init`/`doctor`) and the `runAppCli` dispatcher the umbrella
 * `@sentropic/cli` (lot a2) wires as `stp app`. The embedded app-template subtree lands in
 * a later lot.
 */

export * from './templating/index.js';
export * from './generator/index.js';
export * from './commands/index.js';
export * from './manifest/index.js';
export { runAppCli, BUILD_CLI_VERSION, type AppCliDeps } from './cli.js';
export { buildCliCommandIntentAdapter } from './command-intent.js';
