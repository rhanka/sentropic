/**
 * Deterministic `{{token}}` substitution (R10 invariant).
 *
 * Rules:
 * - A token marker is `{{` + optional whitespace + identifier + optional whitespace + `}}`.
 * - An identifier is `[A-Za-z0-9_]+` (slug-safe, no dotted paths in the MVP).
 * - Every referenced token MUST exist in the `TokenMap`, else `MissingTokenError` is
 *   thrown with the full, de-duplicated, sorted list of missing names (deterministic).
 * - Substitution is single-pass: replacement values are inserted verbatim and are NOT
 *   re-scanned for further markers, so values containing `{{...}}` are safe and the
 *   function is idempotent on already-rendered content (which contains no markers).
 * - No clock, randomness, environment, or locale access — output depends only on inputs.
 */

import { MissingTokenError, type TemplateRenderer, type TokenMap } from './types.js';

/** Matches `{{ identifier }}` with optional surrounding whitespace. */
const TOKEN_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * Return the sorted, de-duplicated list of token identifiers referenced in `template`.
 */
export function extractTokens(template: string): string[] {
    const found = new Set<string>();
    for (const match of template.matchAll(TOKEN_PATTERN)) {
        found.add(match[1]);
    }
    return [...found].sort();
}

/**
 * Substitute every `{{token}}` in `template` from `tokens`.
 *
 * @throws {MissingTokenError} when one or more referenced tokens are absent.
 */
export function substitute(template: string, tokens: TokenMap): string {
    const missing = new Set<string>();
    for (const name of extractTokens(template)) {
        if (!Object.prototype.hasOwnProperty.call(tokens, name)) {
            missing.add(name);
        }
    }
    if (missing.size > 0) {
        throw new MissingTokenError([...missing].sort());
    }
    // Single pass: replacements are not re-scanned (idempotent, value-safe).
    return template.replace(TOKEN_PATTERN, (_full, name: string) => tokens[name]);
}

/**
 * The default `TemplateRenderer` implementation backed by {@link substitute}.
 *
 * Exposed as an object so consumers depend on the interface, not the free function —
 * this is the R5 seam a future `@sentropic/harness` engine can satisfy in place.
 */
export const defaultRenderer: TemplateRenderer = {
    render: substitute,
};
