/**
 * Generator core — public types.
 *
 * The planner is pure: it turns a `ScaffoldManifest` + `GeneratorOptions` into an
 * ordered, fully-rendered `ScaffoldPlan`. It performs NO filesystem I/O, so it can be
 * golden-tested byte-for-byte (R10). A thin writer (see `writer.ts`) materialises a plan.
 */

import type { TemplateRenderer, TokenMap } from '../templating/types.js';

/** Options driving a single scaffold run. */
export interface GeneratorOptions {
    /** Tokens substituted into both output paths and file content. */
    readonly tokens: TokenMap;
    /**
     * Optional renderer override (R5 seam). Defaults to the substrate's `defaultRenderer`
     * when omitted. Supplying one lets a future `@sentropic/harness` engine drive planning.
     */
    readonly renderer?: TemplateRenderer;
}

/** A single resolved output file in a plan. */
export interface PlannedFile {
    /** Final POSIX-style relative output path (tokens already substituted). */
    readonly outputPath: string;
    /** Final file content (tokens substituted + transforms applied). */
    readonly content: string;
    /** Resolved POSIX file mode, or `undefined` to defer to the writer default. */
    readonly mode?: number;
}

/**
 * A fully-resolved, deterministic scaffold plan.
 *
 * `files` preserves manifest order. The same manifest + options always yields a
 * byte-identical plan (R10).
 */
export interface ScaffoldPlan {
    readonly files: readonly PlannedFile[];
}

/** Error thrown when a manifest would emit the same output path more than once. */
export class DuplicateOutputPathError extends Error {
    readonly outputPath: string;
    constructor(outputPath: string) {
        super(`Duplicate output path in scaffold plan: ${outputPath}`);
        this.name = 'DuplicateOutputPathError';
        this.outputPath = outputPath;
    }
}
