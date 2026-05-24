/**
 * Caller-injected adapters that bridge `@sentropic/skills` to DB- or
 * filesystem-bound capabilities living in the API workspace. Skills MUST stay
 * free of `api/`-side imports; concrete callers (chat-service, queue-manager)
 * implement these interfaces and pass them through `SkillToolInvocation.caller`.
 */

/**
 * Request shape consumed by `TemplateRenderer.renderTemplate`. Mirrors the
 * legacy `DocxGenerateRequest` from `api/src/services/docx-generation.ts` so
 * the BR19-D3 closing rebind can wrap `generateDocxForEntity` directly.
 *
 * Only the fields needed by the two production templates
 * (`usecase-onepage`, `executive-synthesis-multipage`) are typed strictly;
 * `provided`/`controls` are passthrough envelopes the renderer interprets.
 */
export interface TemplateRenderRequest {
  /**
   * Identifier of the template to render. Production templates as of BR19
   * Wave D step 1.C: `usecase-onepage` (initiative one-pager DOCX),
   * `executive-synthesis-multipage` (folder executive synthesis DOCX).
   */
  readonly templateId: string;
  /** Type of entity backing the template ("initiative" or "folder"). */
  readonly entityType: string;
  /** Concrete entity ID (initiative ID or folder ID). */
  readonly entityId: string;
  /** Workspace scoping for DB queries the adapter performs. */
  readonly workspaceId: string;
  /** Optional template-specific overrides. */
  readonly provided?: Record<string, unknown>;
  /** Optional template-specific runtime controls. */
  readonly controls?: Record<string, unknown>;
  /** Optional locale hint (defaults to "fr" on the adapter side). */
  readonly locale?: string;
}

/**
 * Result shape returned by `TemplateRenderer.renderTemplate`. Mirrors
 * `DocxGenerateResult` from `api/src/services/docx-generation.ts`.
 */
export interface TemplateRenderResult {
  /** Suggested file name (already slugified, with extension). */
  readonly fileName: string;
  /** Raw DOCX bytes ready for upload via `files.create`. */
  readonly buffer: Uint8Array;
  /** Canonical MIME type (DOCX) — the renderer is DOCX-only as of v0.1. */
  readonly mimeType: string;
}

/**
 * Injected adapter that renders DB-backed DOCX templates. Implementations
 * live in the API workspace (currently `generateDocxForEntity` in
 * `api/src/services/docx-generation.ts`). The skills package only declares
 * the contract.
 */
export interface TemplateRenderer {
  renderTemplate(request: TemplateRenderRequest): Promise<TemplateRenderResult>;
}
