/**
 * In-repo `focus` subcommand wire for the `stp` umbrella CLI (Focus-M1 L3).
 *
 * `@sentropic/focus` is a PRIVATE, app-local-first package (not yet published), so it is NOT a
 * cross-repo federation manifest entry — the manifest is documented + test-locked as cross-repo-
 * only (`federation.spec.ts` asserts its length is 6). Instead the composition root (`bin/stp.mjs`)
 * calls {@link tryRegisterFocus} after wiring the in-repo `app` subcommand and before the cross-repo
 * federation loader. This is the DECIDED mechanism (Opus 4.8 + Codex 5.5xhigh consensus = Option B,
 * conditional in-repo wire; the manifest is left cross-repo-only).
 *
 * Absent-vs-broken policy (mirrors {@link loadFederatedSubcommands}):
 * - True absence (`ERR_MODULE_NOT_FOUND` / `ERR_PACKAGE_PATH_NOT_EXPORTED`) → silently skip. This
 *   happens when `stp` is published standalone without the in-repo `@sentropic/focus` on disk —
 *   `focus` simply does not appear in `stp --help`.
 * - Installed-but-broken (any other import error, or the module fails the `{ run, version }` shape
 *   check) → report via `deps.error` and rethrow. A BROKEN in-repo focus must NOT masquerade as
 *   "absent" — silent omission would hide a real breakage.
 */

import type { SubcommandRegistry } from "./registry.js";

/** The import specifier of the in-repo focus CLI subpath. */
const FOCUS_IMPORT_SPECIFIER = "@sentropic/focus/cli";

/** Node error-code strings that indicate the package is simply not installed. */
const ABSENCE_CODES = new Set(["ERR_MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED"]);

/** The shape the focus `./cli` subpath must export (same contract as the cross-repo CLIs). */
interface FocusCliModule {
    run: (argv: readonly string[]) => Promise<number>;
    version: string;
}

/**
 * Injectable dependencies for {@link tryRegisterFocus}.
 *
 * Defaults are used in production; tests inject alternatives without relying on vitest module-
 * interception hooks (the same injectable-deps style as {@link loadFederatedSubcommands}).
 */
export interface RegisterFocusDeps {
    /** Error output sink (default: `console.error`). */
    readonly error?: (msg: string) => void;
    /**
     * Dynamic import function (default: `(spec) => import(spec)`). Injectable for unit tests so the
     * absent/broken/valid branches can be exercised without `@sentropic/focus` installed.
     */
    readonly importer?: (specifier: string) => Promise<unknown>;
}

/**
 * Attempt to import `@sentropic/focus/cli` and register it as the in-repo `focus` subcommand.
 *
 * Absent (not installed) → silently skipped (registry unchanged). Installed-but-broken (non-absence
 * import error, or a module failing the `{ run, version }` shape check) → reported via `deps.error`
 * and rethrown — never silently omitted.
 *
 * @param registry - The `SubcommandRegistry` to register `focus` into.
 * @param deps - Injectable IO sinks and importer. Useful for testing.
 */
export async function tryRegisterFocus(
    registry: SubcommandRegistry,
    deps: RegisterFocusDeps = {},
): Promise<void> {
    const error = deps.error ?? ((msg: string) => console.error(msg));
    const importer = deps.importer ?? ((spec: string) => import(spec));

    let mod: unknown;
    try {
        mod = await importer(FOCUS_IMPORT_SPECIFIER);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (ABSENCE_CODES.has(code ?? "")) {
            // True absence: focus is not on disk (e.g. stp published standalone) — silently skip.
            return;
        }
        // Installed-but-broken: surface the error and rethrow (do not masquerade as absent).
        error(
            `[stp focus] Failed to load "${FOCUS_IMPORT_SPECIFIER}": ${String(err)}`,
        );
        throw err;
    }

    // Validate the { run, version } shape before registration.
    if (
        mod === null ||
        typeof mod !== "object" ||
        typeof (mod as Record<string, unknown>)["run"] !== "function" ||
        typeof (mod as Record<string, unknown>)["version"] !== "string"
    ) {
        const shapeError = new Error(
            `Module "${FOCUS_IMPORT_SPECIFIER}" does not export { run: function, version: string }. ` +
                `Got: run=${typeof (mod as Record<string, unknown>)?.["run"]}, ` +
                `version=${typeof (mod as Record<string, unknown>)?.["version"]}`,
        );
        error(`[stp focus] Invalid shape for "${FOCUS_IMPORT_SPECIFIER}": ${shapeError.message}`);
        throw shapeError;
    }

    const typedMod = mod as FocusCliModule;

    try {
        registry.register({
            name: "focus",
            summary:
                "Render a track decision dossier (read-only): stp focus <id> [--format terminal|md|html].",
            version: typedMod.version,
            run: typedMod.run,
        });
    } catch (err) {
        error(`[stp focus] Registration failed for "${FOCUS_IMPORT_SPECIFIER}": ${String(err)}`);
        throw err;
    }
}
