/**
 * Templating substrate — public types (R5 seam to a future `@sentropic/harness`).
 *
 * The substrate is intentionally dependency-light and pure: it operates on plain
 * in-memory values (strings + records), never on the filesystem, the clock, or the
 * environment. This keeps it deterministic (R10) and trivially testable, and lets a
 * future generic templating engine adopt the same interface without a v-bump.
 */

/**
 * A flat map of token name -> replacement value.
 *
 * Token names are the identifiers found inside `{{ ... }}` markers. Values are
 * substituted verbatim (no escaping, no coercion beyond `String`-typed inputs).
 */
export type TokenMap = Readonly<Record<string, string>>;

/**
 * Per-file transform applied to rendered content after token substitution.
 *
 * Transforms MUST be pure and deterministic (no clock/random/env access) to preserve
 * the R10 byte-identical-output invariant.
 */
export type ContentTransform = (content: string) => string;

/**
 * A single template entry in a scaffold manifest.
 *
 * `sourcePath` and `outputPath` are POSIX-style relative paths (forward slashes). Both
 * the paths and the content may carry `{{token}}` markers; all are substituted from the
 * same `TokenMap` so an output path can embed e.g. the app slug.
 */
export interface ManifestEntry {
    /** POSIX-style relative path of the template source (informational / provenance). */
    readonly sourcePath: string;
    /** POSIX-style relative output path; may itself contain `{{token}}` markers. */
    readonly outputPath: string;
    /** Raw template content; may contain `{{token}}` markers. */
    readonly content: string;
    /** Optional ordered post-substitution transforms (pure). */
    readonly transforms?: readonly ContentTransform[];
    /**
     * Optional POSIX file mode (octal, e.g. 0o755 for an executable). When omitted the
     * writer uses its own default. Recorded here so executable bits are deterministic.
     */
    readonly mode?: number;
}

/**
 * A scaffold manifest: the ordered set of template entries that make up a scaffold.
 *
 * Order is significant and preserved end-to-end so planned output is deterministic.
 */
export interface ScaffoldManifest {
    readonly entries: readonly ManifestEntry[];
}

/**
 * The substitution contract (R5 seam).
 *
 * A renderer turns a `{{token}}`-bearing template into a fully-substituted string given
 * a `TokenMap`. Missing tokens are an explicit error (never silently left in place or
 * blanked), which is what makes golden fixtures trustworthy.
 */
export interface TemplateRenderer {
    render(template: string, tokens: TokenMap): string;
}

/** Error thrown when a template references a token absent from the `TokenMap`. */
export class MissingTokenError extends Error {
    readonly tokens: readonly string[];
    constructor(tokens: readonly string[]) {
        super(`Missing token(s): ${tokens.join(', ')}`);
        this.name = 'MissingTokenError';
        this.tokens = tokens;
    }
}
