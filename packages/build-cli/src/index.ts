/**
 * `@sentropic/build-cli` public entry point.
 *
 * BR-42a1 foundation: the deterministic templating substrate (R10) + the pure generator
 * core, behind interfaces designed for later `@sentropic/harness` adoption (R5). The
 * `stp app` commands, the embedded app-template subtree, and the umbrella wiring land in
 * later lots.
 */

export * from './templating/index.js';
export * from './generator/index.js';
