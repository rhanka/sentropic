/**
 * `@sentropic/cli` public entry point — the umbrella CLI binary `stp` (alias `sentropic`).
 *
 * BR-42a1 (lot a2): the typed subcommand-registration seam ({@link SubcommandRegistry} +
 * {@link Subcommand}) and the plugin-agnostic dispatcher ({@link runCli}). Per D1, only
 * `stp app` (backed by `@sentropic/build-cli`) is a real subcommand for the MVP; the
 * federation points `stp graphify` / `stp h2a` / `stp remote` are reserved (separate repos)
 * and slot into this same contract later. The `app` subcommand is wired by the `stp` bin
 * (the composition root), so this core module imports no subcommand package — no cycle.
 */

export { CLI_VERSION, runCli, type CliDeps } from './cli.js';
export {
    SubcommandRegistry,
    DuplicateSubcommandError,
    InvalidSubcommandError,
    type Subcommand,
} from './registry.js';
export { VerbRegistry, DuplicateVerbError, type VerbBinding } from './verb-registry.js';
export {
    FEDERATION_MANIFEST,
    loadFederatedSubcommands,
    type FederationEntry,
    type LoadFederationDeps,
} from './federation.js';
