#!/usr/bin/env node
/**
 * `stp` binary entry (also published as `sentropic`).
 *
 * This is the umbrella CLI's composition root: it builds the subcommand registry, wires
 * the real subcommands (only `app`, backed by `@sentropic/build-cli`, in the BR-42a1 MVP),
 * then hands `process.argv.slice(2)` to the plugin-agnostic dispatcher and exits with its
 * code. Keeping the `@sentropic/build-cli` import here (the bin, not the typechecked
 * `src/**` core) means the core stays free of any concrete subcommand dependency and there
 * is no `cli → build-cli → cli` cycle (`build-cli` never imports `cli`).
 *
 * The built library lives at ../dist (produced by `tsc -p tsconfig.json`).
 */

import { runCli, SubcommandRegistry } from '../dist/index.js';
import { runAppCli, BUILD_CLI_VERSION } from '@sentropic/build-cli';

function buildRegistry() {
    const registry = new SubcommandRegistry();
    registry.register({
        name: 'app',
        summary: 'Scaffold and operate a runnable @sentropic chat application (init, doctor).',
        version: BUILD_CLI_VERSION,
        run: (argv) => runAppCli(argv),
    });
    // Reserved federation points (stp graphify / stp h2a / stp remote) live in their own
    // repos and self-register through this same seam later — OUT of BR-42a scope.
    return registry;
}

const code = await runCli(process.argv.slice(2), buildRegistry());
process.exit(code);
