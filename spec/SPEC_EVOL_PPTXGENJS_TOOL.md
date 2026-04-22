# SPEC EVOL - PptGenJS Presentation Tool

Status: Draft for BR-21a Lot 0. Not user-validated. Do not implement from this spec until Q1-Q8 are explicitly selected or edited by the user.

Owner branch: `feat/pptxgenjs-tool-21a`.

## Objective

BR-21a creates a reusable presentation generation capability backed by `pptxgenjs`. The target is the PowerPoint equivalent of the existing freeform DOCX system: a chat-callable tool can upskill the LLM, execute sandboxed generation code, store the resulting file, and return a download affordance.

The branch is intentionally profile-neutral. CV transpose, profile entities, staffing, and profile export workflows belong to a future profile branch or later consumers.

## Existing Reference: Freeform DOCX

Current DOCX generation provides the reference pattern:

- Tool: `document_generate`.
- Two-phase flow: `action: "upskill"` then `action: "generate"`.
- Freeform generation executes JavaScript in a Node VM sandbox.
- The code returns a `docx.Document`.
- The generated file is uploaded to S3-compatible storage.
- A completed `docx_generate` job row is persisted immediately.
- The chat result includes a `jobId` and file metadata.
- The UI renders an inline download card through the existing DOCX download path.

BR-21a should copy that contract where it is sound and diverge only where presentation generation needs a distinct surface.

## Non-Goals

- Do not implement profile exports.
- Do not add profile tables, profile APIs, proposal staffing, or CV extraction.
- Do not build a template marketplace.
- Do not parse uploaded PPTX templates in BR-21a unless explicitly added after brainstorming.
- Do not broaden document RAG, Google Drive, or LLM mesh behavior.

## Brainstorming Questions

### Q1 - Tool Surface

Question: Should presentation generation be a dedicated tool or a mode of `document_generate`?

Options:

- 1A (recommended): Add `presentation_generate`.
- 1B: Extend `document_generate` with `format: "pptx"`.
- 1C: Backend route only.

Recommendation: 1A. A dedicated tool avoids overloading `document_generate`, keeps tool descriptions short, and makes PPTX-specific upskill guidance easier to maintain.

### Q2 - Execution Model

Question: Should freeform PPTX generation be synchronous like DOCX or queued?

Options:

- 2A (recommended): Synchronous freeform generation in the chat handler.
- 2B: Queue every PPTX generation.
- 2C: Synchronous freeform generation now, queued template/batch generation later.

Recommendation: 2A for BR-21a. This matches freeform DOCX and reduces moving parts. 2C is compatible as a later extension if template or batch presentation generation appears.

### Q3 - Output Contract

Question: How should the generated PPTX be returned?

Options:

- 3A (recommended): Store the PPTX in S3-compatible storage, persist a completed `pptx_generate` job, return a download card payload.
- 3B: Return base64 in the tool result.
- 3C: Stream the file directly from the chat response path.

Recommendation: 3A. It mirrors the DOCX path, avoids bloating chat messages, and gives the UI a stable download URL.

### Q4 - Upskill Contract

Question: Should the LLM receive a presentation-generation skill before writing code?

Options:

- 4A (recommended): `presentation_generate({ action: "upskill" })`.
- 4B: Put all instructions directly in the tool description.
- 4C: Return external documentation links.

Recommendation: 4A. PptGenJS layout work benefits from a self-contained skill document with examples, helper functions, layout rules, and sandbox constraints.

### Q5 - Data Context

Question: What data should generated presentations receive?

Options:

- 5A (recommended): Same context pattern as freeform DOCX: workspace-scoped `entityType`, `entityId`, resolved application data, and explicit user-provided content.
- 5B: No application context, only data declared in code.
- 5C: Profile-specific context.

Recommendation: 5A. It makes the tool immediately useful for folders, initiatives, and later profile consumers without coupling BR-21a to profile models. 5C is rejected for this branch.

### Q6 - Sandbox Contract

Question: Should the LLM write JavaScript or a declarative slide JSON schema?

Options:

- 6A (recommended): Node VM sandbox with whitelisted `pptxgenjs` and helpers.
- 6B: Prompt-to-JSON slide DSL interpreted by a renderer.
- 6C: Unrestricted JavaScript.

Recommendation: 6A. It is closest to the working DOCX system and gives enough control for real layouts. 6B is attractive later if we need deterministic template generation, but it is not the fastest path to a usable tool.

### Q7 - UI Download Affordance

Question: Should the UI add a PPTX-specific card or generalize the DOCX card?

Options:

- 7A (recommended): Generalize to a file download card supporting `.docx` and `.pptx`.
- 7B: Add a parallel PPTX card.
- 7C: Return a text URL only.

Recommendation: 7A. The user mental model is "generated file ready to download", not "DOCX-specific artifact". A generic card reduces duplication and prepares for future XLSX/PDF outputs.

### Q8 - Public Naming

Question: What should the public names be?

Options:

- 8A (recommended): Tool `presentation_generate`, job type `pptx_generate`, route `/pptx/jobs/:id/download`.
- 8B: Tool `pptx_generate`.
- 8C: Tool `slide_generate`.

Recommendation: 8A. `presentation_generate` is user-facing and format-friendly, while `pptx_generate` stays precise for job routing and file storage.

## Proposed Initial Contract

If recommendations 1A/2A/3A/4A/5A/6A/7A/8A are accepted:

```ts
type PresentationGenerateArgs =
  | {
      action: 'upskill';
    }
  | {
      action: 'generate';
      mode: 'freeform';
      entityType?: 'workspace' | 'folder' | 'initiative' | 'organization' | 'solution' | 'product' | 'proposal';
      entityId?: string;
      title?: string;
      code: string;
    };
```

The generation code must return a `pptxgenjs` presentation instance or a buffer produced by an approved helper. The service validates the return type, writes the PPTX to object storage, records a completed `pptx_generate` job, and returns:

```json
{
  "ok": true,
  "mode": "freeform",
  "format": "pptx",
  "jobId": "job_123",
  "fileName": "presentation-folder-abcd1234.pptx",
  "downloadUrl": "/pptx/jobs/job_123/download"
}
```

## Expected Helper Shape

The sandbox should expose:

- `pptxgenjs` or a `pptx()` helper to create a presentation.
- Layout helpers for slide size, title, section text, bullets, tables, image placeholders, and footer/page numbering.
- Color and typography helpers using explicit sizes, no viewport-dependent sizing.
- Safe access to `context` with resolved entity data and user-provided prompt data.

The sandbox must not expose filesystem, network, process, dynamic imports, or unrestricted timers.

## Storage and Download

Recommended storage key pattern:

```text
pptx-cache/<workspaceId>/freeform/<entityType>/<entityId>/<jobId>.pptx
```

Recommended route:

```text
GET /api/v1/pptx/jobs/:jobId/download
```

The route should mirror `GET /api/v1/docx/jobs/:jobId/download` and enforce workspace access.

## Test Plan

Focused API/unit tests:

- `pptx-freeform-helpers` exposes deterministic helpers.
- generation rejects syntax errors with a stable error code.
- generation rejects invalid return types.
- generation accepts a minimal valid presentation.
- generated buffer starts with ZIP/PPTX-compatible bytes and contains expected presentation entries.
- storage upload is called with `.pptx` content type and deterministic key prefix.
- completed `pptx_generate` metadata is persisted with download-compatible result shape.
- chat tool `upskill` returns skill content without generating a file.
- chat tool `generate` returns a download card payload.

UI tests if the card is generalized:

- DOCX card still renders.
- PPTX card renders filename and download action.
- Unknown generated file formats degrade safely.

## Open Decisions

The proposed launch bundle is:

```text
1A 2A 3A 4A 5A 6A 7A 8A
```

Implementation must not start until the selected answer block is recorded in `BRANCH.md` after user validation.
