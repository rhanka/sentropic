# SPEC EVOL - PptGenJS Format for `document_generate`

Status: Draft from validated BR-21a Q&A.

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

## Non-Goals

- Do not create a separate public `presentation_generate`, `pptx_generate`, or `slide_generate` tool.
- Do not implement profile export, CV transpose, or profile-specific templates.
- Do not parse or import existing PPTX files in this branch.
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
- Tool errors must be returned as `tool_call_result` errors, same as the DOCX freeform path.

## Upskill Contract

`document_generate({ action: "upskill", format: "pptx" })` returns a compact PptGenJS-focused skill document adapted from the Anthropic PPTX skill.

The upskill content must be self-contained and fit the Entropic sandbox:

- JavaScript/PptGenJS only.
- No filesystem access.
- No network access.
- No template editing/import in BR-21a.
- Emphasize explicit slide dimensions, inches-based coordinates, text-box margins, font sizing, visual hierarchy, and non-text-only slides.

## Sandbox Contract

PPTX freeform generation executes JavaScript in a Node VM sandbox, parallel to freeform DOCX.

The sandbox exposes:

- `pptxgenjs` or a local `pptx()` helper to create a presentation.
- Layout helpers for title, section, bullet list, table, stat callout, footer, and visual placeholder patterns.
- A readonly `context` object using the same entity context model as DOCX.

The sandbox does not expose:

- filesystem APIs
- network APIs
- `process`
- dynamic imports
- unrestricted timers

Return contract:

- The code must return a PptGenJS presentation object or a service-approved wrapper result.
- The service writes the presentation to a PPTX buffer.
- Invalid return values fail with a stable error code.

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

Route naming should be mutualized with DOCX where practical. The implementation must preserve existing DOCX downloads. If fully migrating DOCX to a generic route is too risky for BR-21a, keep DOCX compatibility and add the smallest shared adapter that lets the chat UI render both DOCX and PPTX through one generated-file card.

## Storage Contract

Use S3-compatible object storage like DOCX. Recommended PPTX key pattern:

```text
generated-files/<workspaceId>/pptx/freeform/<entityType>/<entityId>/<jobId>.pptx
```

The job/result metadata must be sufficient for the download endpoint to enforce workspace access and resolve the storage key without trusting client-provided paths.

## UI Contract

Generalize the existing DOCX download card into a generated-file card:

- Supports at least `docx` and `pptx`.
- Displays filename and format.
- Uses the provided download URL or constructs it from `jobId` through the shared generated-file route.
- Keeps current DOCX behavior unchanged.
- Unknown generated formats must degrade safely.

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
