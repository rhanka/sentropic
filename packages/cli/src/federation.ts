/**
 * Static federation manifest for the `stp` umbrella CLI (BR-42i).
 *
 * Defines the known cross-repo CLI roster and the discovery loader that attempts to
 * dynamically import each entry at startup. The composition root (`bin/stp.mjs`) calls
 * {@link loadFederatedSubcommands} after wiring the in-repo subcommands (`app`, etc.).
 *
 * Absent-vs-broken policy (Codex MF1):
 * - True absence (`ERR_MODULE_NOT_FOUND` / `ERR_PACKAGE_PATH_NOT_EXPORTED`) → silently skip.
 *   The subcommand simply does not appear in `stp --help`.
 * - Installed-but-broken (any other import error, or the resolved module fails the
 *   `{ run, version }` shape check → `InvalidSubcommandError`) → fail loudly via
 *   `deps.error` and rethrow. Silent omission would hide a real breakage as "missing".
 *
 * NOTE: `app` (in-repo, hard-imported in bin) and `harness` (GATED_D7 — wired after
 * BR-42h creates + publishes the harness CLI contract) are NOT in this manifest.
 */

import type { SubcommandRegistry } from './registry.js';

/** A single entry in the static federation manifest. */
export interface FederationEntry {
    /** Invocation token after `stp` (e.g. `h2a`). */
    readonly name: string;
    /** One-line summary rendered by `stp --help`. */
    readonly summary: string;
    /**
     * Import specifier used verbatim in `import(entry.importSpecifier)` (e.g.
     * `@sentropic/h2a/cli`). Must point to a module that exports `{ run, version }`.
     */
    readonly importSpecifier: string;
}

/**
 * The canonical cross-repo federation roster for `stp`.
 *
 * Entries are ordered by name for determinism. All entries are cross-repo packages;
 * in-repo CLIs (`app`, `harness`) are wired separately by the composition root.
 *
 * `harness` is intentionally excluded: it is gated to D7 (BR-42h must first create +
 * publish `@sentropic/harness` CLI contract before it can be discovered here).
 */
export const FEDERATION_MANIFEST: readonly FederationEntry[] = [
    {
        name: 'agent-stats',
        summary: 'Session telemetry, anomaly detection, and CompoundSignal analytics.',
        importSpecifier: '@sentropic/agent-stats/cli',
    },
    {
        name: 'design',
        summary: 'Design-system lint, a11y checks, and token validation.',
        importSpecifier: '@sentropic/design-system-skills/cli',
    },
    {
        name: 'h2a',
        summary: 'Agent-to-agent trust coordination and session management.',
        importSpecifier: '@sentropic/h2a/cli',
    },
    {
        name: 'knowledge',
        summary: 'Knowledge graph indexing and retrieval (graphify).',
        importSpecifier: '@sentropic/graphify/cli',
    },
    {
        name: 'remote',
        summary: 'Session secrets and deploy-target management.',
        importSpecifier: 'sentropic-remote/cli',
    },
    {
        name: 'track',
        summary: 'Acceptance tracking, realization, decisions, and status reporting.',
        importSpecifier: '@sentropic/track/cli',
    },
    // GATED_D7: harness (`@sentropic/harness/cli`) is not in this manifest.
    // It will be added in a single-line manifest entry after BR-42h creates + publishes the
    // harness CLI contract (`runHarnessCli` + version export, private:false).
] as const;

/**
 * The shape every federated cross-repo CLI must export from its `./cli` subpath.
 * The loader validates this at runtime before calling `registry.register(...)`.
 */
interface FederatedCliModule {
    run: (argv: readonly string[]) => Promise<number>;
    version: string;
}

/** Node error-code strings that indicate the package is simply not installed. */
const ABSENCE_CODES = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED']);

/**
 * Injectable dependencies for {@link loadFederatedSubcommands}.
 *
 * All fields are optional — defaults are used for production; tests inject alternatives
 * without relying on vitest module interception hooks.
 */
export interface LoadFederationDeps {
    /** Error output sink (default: `console.error`). */
    readonly error?: (msg: string) => void;
    /**
     * Dynamic import function (default: `(spec) => import(spec)`).
     * Injectable for unit tests — avoids vitest mock-hoisting fragility for runtime
     * specifiers. The real bin always uses the default.
     */
    readonly importer?: (specifier: string) => Promise<unknown>;
}

/**
 * Dynamically import each {@link FEDERATION_MANIFEST} entry and register it in the
 * provided registry.
 *
 * Absent packages are silently skipped. Installed-but-broken packages (import throws a
 * non-absence error, or the module fails the `{ run, version }` shape check) are reported
 * via `deps.error` and their error is rethrown — never silently omitted.
 *
 * @param registry - The `SubcommandRegistry` to register discovered CLIs into.
 * @param deps - Injectable IO sinks and importer. Useful for testing.
 */
export async function loadFederatedSubcommands(
    registry: SubcommandRegistry,
    deps: LoadFederationDeps = {},
): Promise<void> {
    const error = deps.error ?? ((msg: string) => console.error(msg));
    const importer = deps.importer ?? ((spec: string) => import(spec));

    for (const entry of FEDERATION_MANIFEST) {
        let mod: unknown;
        try {
            mod = await importer(entry.importSpecifier);
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (ABSENCE_CODES.has(code ?? '')) {
                // True absence: the package is simply not installed — silently skip.
                continue;
            }
            // Installed-but-broken: surface the error and rethrow.
            error(
                `[stp federation] Failed to load "${entry.name}" (${entry.importSpecifier}): ${String(err)}`,
            );
            throw err;
        }

        // Validate the { run, version } shape before registration.
        if (
            mod === null ||
            typeof mod !== 'object' ||
            typeof (mod as Record<string, unknown>)['run'] !== 'function' ||
            typeof (mod as Record<string, unknown>)['version'] !== 'string'
        ) {
            const shapeError = new Error(
                `Module "${entry.importSpecifier}" does not export { run: function, version: string }. ` +
                    `Got: run=${typeof (mod as Record<string, unknown>)?.['run']}, ` +
                    `version=${typeof (mod as Record<string, unknown>)?.['version']}`,
            );
            error(
                `[stp federation] Invalid shape for "${entry.name}" (${entry.importSpecifier}): ${shapeError.message}`,
            );
            throw shapeError;
        }

        const typedMod = mod as FederatedCliModule;

        // Delegate final validation to the registry (InvalidSubcommandError on malformed entries).
        try {
            registry.register({
                name: entry.name,
                summary: entry.summary,
                version: typedMod.version,
                run: typedMod.run,
            });
        } catch (err) {
            error(
                `[stp federation] Registration failed for "${entry.name}" (${entry.importSpecifier}): ${String(err)}`,
            );
            throw err;
        }
    }
}
