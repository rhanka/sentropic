/**
 * @sentropic/cited-source-viewer — public TypeScript surface.
 *
 * Re-exports the seam types (local frozen-contract mirror), the pure engines
 * (quote matching, markdown rendering, pdf geometry) and the body-renderer
 * registry. Svelte components are NOT re-exported here: consumers import them
 * through the `./CitedSourceViewer.svelte` / `./bodies/*.svelte` package
 * exports so the bundler keeps `.svelte` handling (same convention as
 * @sentropic/chat-ui).
 */

export * from "./types.js";
export * from "./quoteMatch.js";
export * from "./markdownSource.js";
export * from "./pdfEngine.js";
export * from "./bodies/registry.js";
