# SPEC EVOL - PptGenJS Format for `document_generate`

Status: Lot 2 contract frozen from validated BR-21a Q&A.

Owner branch: `feat/pptxgenjs-tool-21a`.

Validated answer block: `1X 2B 3A 4A 5A 6A 7X 8A`.

## Objective

Extend the existing `document_generate` chat tool so it can generate either DOCX or PPTX:

```ts
format?: 'docx' | 'pptx';
```

`format` defaults to `docx` for backwards compatibility. PPTX generation uses sandboxed PptGenJS code with exposed helper functions, mirroring the current freeform DOCX sandbox pattern.

Generated PPTX files must appear in chat as generated-file artifacts alongside generated DOCX files. BR-21a does not introduce profile/CV concepts.

## Source References

The PPTX upskill content should be adapted from the official Anthropic `pptx` skill references, without vendoring proprietary text:

- `https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md`
- `https://github.com/anthropics/skills/blob/main/skills/pptx/pptxgenjs.md`

Relevant ideas to adapt:

- PptGenJS from-scratch generation patterns.
- Slide layout dimensions and coordinate conventions.
- Text, rich text, spacing, margins, and visual inspection guidance.
- Design quality guardrails such as avoiding text-only slides and using topic-specific visual structure.

Adaptation limits:

- Anthropic `pptx` references now include editing-oriented workflows. BR-21a must ignore those editing paths.
- Do not port Python-based PPTX editing helpers or local filesystem workflows.
- Do not assume Claude's skill sandbox model matches Sentropic's runtime. Sentropic uses the existing DOCX-style JavaScript VM sandbox pattern and only exposes approved PptGenJS helpers.
- Use the references to write compact generation guidance, not as an implementation contract for import/edit/repair flows.

## Non-Goals

- Do not create a separate public `presentation_generate`, `pptx_generate`, or `slide_generate` tool.
- Do not implement profile export, CV transpose, or profile-specific templates.
- Do not parse or import existing PPTX files in this branch.
- Do not edit existing PPTX files in this branch.
- Do not use Python PPTX libraries or Python-based PPTX editing helpers in this branch.
- Do not add reusable PPTX template management in this branch.
- Do not broaden Google Drive, LLM mesh, or RAG behavior.

## Tool Contract

Current `document_generate` behavior remains valid. BR-21a adds a format discriminator:

```ts
type DocumentGenerateFormat = 'docx' | 'pptx';

type DocumentGenerateArgs =
  | {
      action: 'upskill';
      format?: DocumentGenerateFormat;
    }
  | {
      action: 'generate';
      format?: DocumentGenerateFormat;
      mode: 'freeform';
      entityType?: 'workspace' | 'folder' | 'initiative' | 'organization' | 'solution' | 'product' | 'proposal';
      entityId?: string;
      title?: string;
      code: string;
    };
```

Compatibility rules:

- Missing `format` means `docx`.
- Existing DOCX prompts and calls must continue working.
- `format: "pptx"` selects the PptGenJS upskill/generate path.
- `format` is accepted on both `upskill` and `generate`; unsupported values fail validation before generation.
- PPTX generation is available only for `mode: "freeform"`/`code` generation in this branch.
- Template-driven PPTX generation is explicitly out of scope for BR-21a.
- Tool errors must be returned as `tool_call_result` errors, same as the DOCX freeform path.
- The public chat tool name remains `document_generate`; BR-21a must not register `presentation_generate`, `pptx_generate`, or `slide_generate`.

Frozen naming:

- Public chat tool: `document_generate`
- DOCX job type: existing `docx_generate`
- PPTX job type: internal `pptx_generate`
- Canonical generated-file download route: `GET /generated-files/jobs/:jobId/download`
- DOCX compatibility route: `GET /docx/jobs/:jobId/download` remains valid for existing callers and persisted chat history
- No public PPTX-only chat tool surface or PPTX-only user workflow is added in BR-21a

## Upskill Contract

`document_generate({ action: "upskill", format: "pptx" })` returns a compact PptGenJS-focused skill document adapted from the Anthropic PPTX skill.

The upskill content must be self-contained and fit the Sentropic sandbox:

- JavaScript/PptGenJS only.
- Generation only; no existing-presentation editing instructions.
- No filesystem access.
- No network access.
- No template editing/import in BR-21a.
- No Python helper references.
- Emphasize explicit slide dimensions, inches-based coordinates, text-box margins, font sizing, visual hierarchy, and non-text-only slides.
- Encourage calling `document_generate({ action: "upskill", format: "pptx" })` before the first PPTX `generate` call in a conversation.
- Avoid long vendored external text; keep the skill compact and Sentropic-specific.

## Sandbox Contract

PPTX freeform generation executes JavaScript in a Node VM sandbox, parallel to freeform DOCX.

The sandbox exposes:

- `pptxgenjs` advanced exports where safe for normal PptGenJS authoring.
- `pptx(opts?)` to create a presentation with default wide layout and theme.
- `titleSlide(presentation, title, subtitle?, opts?)`.
- `sectionSlide(presentation, title, subtitle?, opts?)`.
- `textBox(slide, text, opts)` for stable text boxes.
- `bullets(slide, items, opts)` for bullet lists without hand-coded glyphs.
- `table(slide, headers, rows, opts)` for table slides with consistent sizing.
- `statCallout(slide, label, value, opts)` for metric cards.
- `footer(slide, text, opts?)` for small footer text.
- `visualPlaceholder(slide, label, opts)` for explicit image/diagram placeholders when no real asset is available.
- `safeText(value, fallback?)` for defensive text coercion.
- A readonly `context` object using the same entity context model as DOCX.

The sandbox does not expose:

- filesystem APIs
- network APIs
- `process`
- dynamic imports
- unrestricted timers

Return contract:

- The code must return a PptGenJS presentation object created by `pptx()` or `new pptxgenjs()`.
- A wrapper result may be accepted only if it has `{ presentation, fileName? }`.
- The service writes the presentation to a PPTX buffer.
- Invalid return values fail with a stable error code.
- Execution is synchronous from the caller perspective, but writing the presentation buffer may await PptGenJS packaging.

Stable error codes:

- `code_syntax_error` for JavaScript syntax failures.
- `code_runtime_error` for sandbox execution failures.
- `code_timeout` for VM timeout.
- `invalid_return_type` when the code does not return a presentation or approved wrapper.
- `pptx_packaging_error` when PptGenJS cannot serialize the returned presentation.
- `not_found` when the requested entity context cannot be loaded.
- `storage_error` and `persistence_error` for later chat integration failures after the buffer is produced.

## Generated File Contract

BR-21a should mutualize generated-file handling with DOCX instead of creating a separate PPTX-only chat surface.

The tool result should include a format-aware generated-file payload:

```json
{
  "ok": true,
  "tool": "document_generate",
  "format": "pptx",
  "mode": "freeform",
  "jobId": "job_123",
  "fileName": "presentation-folder-abcd1234.pptx",
  "mimeType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "downloadUrl": "/generated-files/jobs/job_123/download"
}
```

Route naming is frozen as a generic generated-file route for new `document_generate` file results. Existing DOCX download URLs remain supported. The UI should prefer `downloadUrl` when present and otherwise derive the legacy DOCX URL from `jobId` for historical messages.

Runtime summary/card contract:

```ts
type GeneratedFileCard = {
  jobId: string;
  fileName: string;
  format: 'docx' | 'pptx';
  mimeType?: string;
  downloadUrl?: string;
};
```

`runtimeSummary.generatedFileCards` is the target field for new history entries. Existing `runtimeSummary.docxCards` may be read only as a compatibility bridge for already persisted DOCX history until the UI migration is complete.

## Storage Contract

Use S3-compatible object storage like DOCX. Recommended PPTX key pattern:

```text
generated-files/<workspaceId>/pptx/freeform/<entityType>/<entityId>/<jobId>.pptx
```

The job/result metadata must be sufficient for the download endpoint to enforce workspace access and resolve the storage key without trusting client-provided paths.

## UI Contract

Generalize the existing DOCX download card into a generated-file card:

- Supports at least `docx` and `pptx`.
- Displays filename and an uppercase format label.
- Uses the provided download URL or constructs it from `jobId` through the shared generated-file route.
- Keeps current DOCX behavior unchanged.
- Unknown generated formats must degrade safely.
- The download button calls one shared generated-file helper, not a DOCX-specific helper.

## Implementation Lots

1. Update `document_generate` schema and tool description with `format`.
2. Add PPTX upskill content adapted from Anthropic `pptx` skill references.
3. Add PptGenJS sandbox helpers and generation service.
4. Add shared generated-file result/card contract while preserving DOCX.
5. Add storage/download handling for PPTX.
6. Add focused tests for DOCX backward compatibility and PPTX generation.

## Test Plan

API/unit:

- Existing DOCX `document_generate` calls without `format` still generate DOCX.
- `document_generate({ action: "upskill", format: "pptx" })` returns PPTX guidance.
- PPTX generation rejects syntax errors with stable errors.
- PPTX generation rejects invalid return values.
- Minimal valid PptGenJS generation produces a PPTX file.
- Generated PPTX metadata includes `format`, `mimeType`, `jobId`, `fileName`, and download URL.
- Download endpoint enforces workspace access.

UI:

- Existing DOCX card still renders and downloads.
- PPTX generated-file card renders and downloads.
- Unknown generated-file format degrades safely.
