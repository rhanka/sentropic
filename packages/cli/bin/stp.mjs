#!/usr/bin/env node
/**
 * `stp` binary entry (also published as `sentropic`).
 *
 * This is the umbrella CLI's composition root: it builds the subcommand registry, wires
 * the real subcommands (only `app`, backed by `@sentropic/build-cli`, in the BR-42a1 MVP),
 * discovers and registers cross-repo federated CLIs (BR-42i — absent ones silently skip),
 * registers bare-verb aliases (e.g. `report` → `track report`), then hands
 * `process.argv.slice(2)` to the plugin-agnostic dispatcher and exits with its code.
 *
 * Keeping the `@sentropic/build-cli` import here (the bin, not the typechecked `src/**`
 * core) means the core stays free of any concrete subcommand dependency and there is no
 * `cli → build-cli → cli` cycle (`build-cli` never imports `cli`).
 *
 * The built library lives at ../dist (produced by `tsc -p tsconfig.json`).
 */

import { runCli, SubcommandRegistry, VerbRegistry, loadFederatedSubcommands } from '../dist/index.js';
import { runAppCli, BUILD_CLI_VERSION } from '@sentropic/build-cli';

async function buildRegistry() {
    const registry = new SubcommandRegistry();
    registry.register({
        name: 'app',
        summary: 'Scaffold and operate a runnable @sentropic chat application (init, doctor).',
        version: BUILD_CLI_VERSION,
        run: (argv) => runAppCli(argv),
    });
    // Discover and register cross-repo federated CLIs. All entries in FEDERATION_MANIFEST
    // that are not installed will silently skip; installed-but-broken will fail loudly.
    await loadFederatedSubcommands(registry, { importer: (spec) => import(spec) });
    return registry;
}

// Initial bare-verb alias roster (BR-42i). `report` dispatches to `stp track report`
// if `track` is installed; falls through to formatUnknown otherwise (not a crash).
const verbRegistry = new VerbRegistry();
verbRegistry.register({
    verb: 'report',
    ownerCli: 'track',
    ownerArgv: ['report'],
    note: 'equiv: stp track report',
});

const code = await runCli(process.argv.slice(2), await buildRegistry(), { verbRegistry });
process.exit(code);
