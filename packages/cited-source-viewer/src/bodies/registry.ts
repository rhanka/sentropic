/**
 * Body-renderer registry — the "one UX, many bodies" seam (§S.4/§S.6).
 *
 * The frame (`CitedSourceViewer.svelte`) owns the canonical S.6 chrome
 * (header, generic toolbar, quote strip, honesty footer) and routes the
 * resolved `SourcePayload` to a body renderer by `payload.kind`. v1 ships two
 * built-in bodies (markdown/text + pdf, registered by the frame itself);
 * v2 (docx, pptx) and v3 (image-bbox) plug in HERE without touching the frame:
 *
 *   import { registerBodyRenderer } from "@sentropic/cited-source-viewer";
 *   registerBodyRenderer("docx", DocxBody); // DocxBody implements CitedSourceBodyProps
 *
 * A body is a Svelte component implementing the `CitedSourceBodyProps`
 * contract (see `types.ts`): payload in, `onStatus`/`registerCommands`/
 * `onRenderError` out. Explicit registrations take precedence over the
 * built-ins, so a consumer can also OVERRIDE a v1 body (e.g. a richer
 * markdown renderer) without forking the frame.
 */

import type { Component } from "svelte";
import type { CitedSourceBodyProps } from "../types.js";

/** A Svelte 5 component implementing the body contract. */
export type CitedSourceBodyComponent = Component<CitedSourceBodyProps>;

const registry = new Map<string, CitedSourceBodyComponent>();

/** Register (or override) the body renderer for a payload `kind`. */
export function registerBodyRenderer(kind: string, component: CitedSourceBodyComponent): void {
  if (!kind || typeof kind !== "string") {
    throw new Error("registerBodyRenderer: kind must be a non-empty string");
  }
  registry.set(kind, component);
}

/** Remove an explicit registration (built-ins are unaffected). */
export function unregisterBodyRenderer(kind: string): void {
  registry.delete(kind);
}

/** The explicitly registered renderer for `kind`, or null. */
export function getBodyRenderer(kind: string): CitedSourceBodyComponent | null {
  return registry.get(kind) ?? null;
}

/** Explicitly registered kinds (built-ins excluded — they live in the frame). */
export function registeredBodyKinds(): string[] {
  return [...registry.keys()];
}
