# SPEC - DOCX Templating

## 1. Purpose

### 1.1 Functional objective
Provide a template-driven DOCX generation capability for business documents:
- initiative one-page report (renamed from "use case one-page");
- executive synthesis multipage report with annexed initiatives;
- freeform DOCX generation via chat tool (`document_generate`).

BR-21a extends the generic `document_generate` chat surface with `format: "pptx"` for freeform PptGenJS presentation generation. That PPTX path is generated-code based, not reusable template management, and is documented in `SPEC_EVOL_PPTXGENJS_TOOL.md`.

The primary concern is functional templating (layout control, marker contract, lifecycle), not endpoint design alone.

### 1.2 Expected product behavior
- Document layout is controlled by `.docx` templates, not hardcoded chapter order.
- Business users can evolve templates without rewriting rendering logic each time.
- Annex and dashboard placement are explicitly controlled by template markers.
- Existing use case one-page export remains available during migration.
- Heavy document rendering is processed asynchronously (job queue), not inline in API request handlers.

### 1.3 Scope for Wave 2 (Lot 2.3)
- Define functional contract and lifecycle for templating.
- Define template/data articulation for use case and executive synthesis documents.
- Define API support model (unified endpoint, compatibility wrapper, renderer registry).

Out of scope in this spec:
- UI template designer.
- Full governance workflow (draft/approval/versioning UI) implementation.
- Reusable PPTX template management.
- PPTX parsing/import.

## 2. Functional model

### 2.1 Templated document families
- `usecase-onepage` (aliased as `initiative-onepage`)
  - Source entity: `initiative` (DB table: `use_cases`, renamed from "use case" at the domain level).
  - Output: one-page document.
  - Current implementation exists and is the migration baseline.
- `executive-synthesis-multipage`
  - Source entity: `folder`.
  - Output: multipage synthesis with optional annex and optional dashboard visual.
- Freeform DOCX (via chat tool)
  - Source entity: any context (initiative, folder, dashboard, etc.).
  - Output: LLM-generated DOCX via `docx.js` code execution in VM sandbox.
  - Triggered by the `document_generate` chat tool with `action: "generate"` and `code` payload.
  - See `SPEC_EVOL_FREEFORM_DOCX.md` for full specification.
- Freeform PPTX (via chat tool, BR-21a)
  - Source entity: the same entity context model as freeform DOCX.
  - Output: LLM-generated PPTX via PptGenJS code execution in VM sandbox.
  - Triggered by `document_generate` with `action: "generate"`, `format: "pptx"`, `mode: "freeform"`/`code`.
  - Uses generated-file storage/download metadata, not a separate presentation tool.
  - See `SPEC_EVOL_PPTXGENJS_TOOL.md` for full specification.

### 2.2 Functional sections
- Initiative one-page sections (formerly "use case one-page"):
  - title and summary fields;
  - detailed blocks (problem, solution, lists, references);
  - scoring visualization and matrix-related values.
- Executive synthesis sections:
  - folder title (must expose `folder.name`);
  - executive summary block (must expose `folder.executiveSummary.synthese_executive`);
  - table of contents (intro + annex + use case entries);
  - introduction;
  - analysis;
  - recommendation;
  - references (optional);
  - annex insertion point for use case pages;
  - dashboard visual insertion point (optional).

### 2.3 Functional marker contract (template language)
- Scalar markers: `{{field}}`
- Loop markers: `{{FOR item IN items}} ... {{END-FOR item}}`
- Sub-template include (selected syntax):
  - `{{INCLUDE template.usecase-onepage.docx WITH ($uc.data || $uc)}}`
- Reserved structural markers for synthesis:
  - Annex block via `FOR + INCLUDE` (required when annex is enabled)
  - `{{provided.dashboardImage}}`

Rules:
- Marker names are stable API-level contracts.
- Section ordering is defined by marker position in template.
- No chapter order hardcoding in service code.
- Mapping should be "as-is first": prefer direct object paths over per-field remapping.
- Include target context is the object passed in `WITH (...)` and becomes the root context of the included template.

### 2.4 Freeform generated documents (BR-04B and BR-21a)

Freeform DOCX generation uses `docx.js` code executed in an isolated VM sandbox (`vm2` or Node `vm`). The LLM writes JavaScript code that imports `docx` to build a document programmatically.

Two-phase pattern:
1. **Upskill**: LLM calls `document_generate({ action: "upskill" })` to receive a self-contained skill document with DOCX best practices and `docx.js` API patterns.
2. **Generate**: LLM calls `document_generate({ action: "generate", code: "..." })` with the `docx.js` code. The code is executed in a sandbox, produces a DOCX buffer, which is uploaded to S3 and a download link returned.

Implementation: `api/src/services/docx-generation.ts` (generateFreeformDocx) + `api/src/services/docx-freeform-helpers.ts` (VM sandbox helpers). Execution is synchronous inside `chat-service.ts` (not queued via `job_queue`).

Generated-file download cards are rendered inline in chat through the shared chat message path (`StreamMessage.svelte` event forwarding + `ChatPanel.svelte` card rendering). The preferred runtime contract is `generatedFileCards`; legacy `runtimeSummary.docxCards` remains accepted as a DOCX-only alias for backward compatibility.

See `SPEC_EVOL_FREEFORM_DOCX.md` for the full specification.

Freeform PPTX generation follows the same two-phase pattern with `format: "pptx"`:
1. **Upskill**: LLM calls `document_generate({ action: "upskill", format: "pptx" })` to receive compact PptGenJS sandbox guidance.
2. **Generate**: LLM calls `document_generate({ action: "generate", format: "pptx", code: "..." })`; the code returns a PptGenJS presentation object, which is packaged, stored, and exposed as a generated-file download.

The public tool remains `document_generate`. BR-21a does not add reusable PPTX templates, PPTX import/parsing, or profile/CV export behavior. The visible chat affordance is shared with DOCX: format label, download action, and generated-file metadata travel through the same generic card contract.

## 3. Template lifecycle vs business objects

### 3.1 Lifecycle phases
1. Contract definition:
  - freeze marker inventory for a template family.
2. Authoring:
  - template file created/updated by user.
3. Intake:
  - template file and intents provided once for a lot.
4. Validation:
  - marker inventory extraction and compatibility checks.
5. Runtime rendering:
  - data provider resolves entity data;
  - renderer patches template.
6. Evolution:
  - contract version can change only with explicit migration/update.

### 3.2 Object articulation
- `usecase-onepage` template binds to `initiatives` (DB table: `use_cases`) (+ folder matrix context when needed).
- `executive-synthesis-multipage` template binds to:
  - `folders` (executive summary source);
  - linked `initiatives` (annex source);
  - optional dashboard payload from client provided data.

### 3.3 Intake bundle for executive synthesis (single lock point)
- Required:
  - `executive-synthesis.docx` master template.
  - annex intent:
    - include annex section: yes/no.
  - annex pagination strategy:
    - defined in the DOCX template layout (not API flags), typically via `Page break before` on the first paragraph/title of `usecase-onepage.docx`.
  - dashboard intent:
    - include dashboard image: yes/no.
  - one reference UAT dataset:
    - folder id containing executive summary + multiple use cases.

### 3.4 Compatibility and fallback policy
- Missing required marker -> contract error (`422`).
- Optional marker missing:
  - if optional section is disabled, no error;
  - if optional section is enabled but marker missing, return contract error (`422`).
- One-page export remains available through the unified async DOCX flow (`templateId=usecase-onepage`);
  legacy synchronous route is intentionally disabled (`410`).

## 4. Data model articulation

### 4.1 Rendering context (as-is first)
- Common:
  - `templateId`
  - `entityType`
  - `entityId`
  - `provided` (UI/user-provided payload)
  - `controls` (render behavior)
- Canonical context envelope:
  - `folder` (full folder object)
  - `usecases` (annex collection, full objects)
  - `provided` (runtime external payload, e.g. dashboard image)
  - `controls` (annex/toc behavior, sub-template selection)
  - `_derived` (computed helpers only: scores visuals, aliases, compatibility)
- Preferred path examples in templates:
  - `{{folder.name}}`
  - `{{folder.executiveSummary.introduction}}`
  - `{{folder.executiveSummary.analyse}}`
  - `{{folder.executiveSummary.recommandation}}`
  - `{{folder.executiveSummary.synthese_executive}}`
  - `{{FOR uc IN (usecases || [])}} ... {{END-FOR uc}}`
- Legacy compatibility policy:
  - keep aliases in `_derived` for existing snake_case fields when needed;
  - avoid duplicating business mapping logic outside `_derived`.
  - accept legacy `options` as backward-compatible alias during migration.

### 4.2 Data ownership
- Business data remains in existing domain tables/services.
- Templating layer consumes normalized DTOs; it does not own business state.
- Template files are stored under `api/templates` in this phase.

### 4.3 Include contract for annex initiatives (formerly "annex use cases")
- Master template annex iteration pattern:
```txt
{{FOR uc IN (usecases || [])}}
{{INCLUDE template.usecase-onepage.docx WITH ($uc.data || $uc)}}
{{END-FOR uc}}
```
- Include resolution contract:
  - if `uc.data` exists, include root context is `uc.data`;
  - otherwise include root context is `uc`;
  - `_derived.usecase[uc.id]` computed fields are merged when available (scores/stars/crosses and print helpers).
- Compatibility target:
  - `usecase-onepage.docx` continues to use existing root markers (`{{name}}`, `{{description}}`, loops, etc.);
  - no mandatory template rewrite for current one-page template.

## 5. Technical support model (API and processing)

### 5.1 Legacy model (pre-Wave 2, for context)
- Legacy route: `GET /api/v1/use-cases/:id/docx` (now disabled with `410 Gone`; aliased as `GET /api/v1/initiatives/:id/docx`)
- Existing renderer path kept as technical base:
  - `api/src/services/docx-service.ts`
  - template loading from `api/templates`
  - placeholder patching with `dolanmiu/docx` and XML loop expansion.

Current limitations:
- one endpoint per document type;
- use case scope only;
- no shared template registry/validation layer.

### 5.2 Target support model
- Unified generation endpoint (async enqueue only):
  - `POST /api/v1/docx/generate`
- Request contract:
```json
{
  "templateId": "usecase-onepage | executive-synthesis-multipage",
  "entityType": "usecase | folder",
  "entityId": "uuid-or-id",
  "provided": {},
  "controls": {},
  "options": {}
}
```
- Request semantics:
  - `provided`: UI/user-provided payload (example: dashboard bitmap);
  - `controls`: render choices (annex mode, toc mode, sub-template ref);
  - `options`: deprecated alias accepted temporarily for backward compatibility.
- Response contract:
  - success: job envelope (`jobId`, `status`, `queueClass`);
  - errors:
    - `400` invalid payload;
    - `404` entity not found (workspace scoped);
    - `422` template/rendering contract error.

### 5.3 Job execution model (queue classes)
- Queue backend remains `job_queue` (single table), with logical classes:
  - `ai` for AI generation jobs;
  - `publishing` for rendering/export jobs (DOCX now, authoring/publishing family later).
- Configurable concurrency by class:
  - `ai_concurrency` (existing);
  - `publishing_concurrency` (new; default `5`).
- Objective:
  - avoid inline DOCX denial-of-service patterns;
  - prevent long DOCX jobs from starving AI jobs.
- Initial publishing job type:
  - `docx_generate`.
- Cancellation:
  - all publishing jobs are interruptible via existing queue cancellation API.

### 5.4 Progress and observability
- Each `docx_generate` job publishes stream events on `streamId = "job_<jobId>"`.
- Progress is emitted as `status` events with structured payload:
  - `state` (`queued`, `loading_data`, `rendering_annex`, `patching`, `packaging`, `done`, `failed`, `cancelled`);
  - `progress` (`0..100`);
  - optional detail (`current`, `total`, `message`).
- Queue snapshots expose current progress for UI job cards.

### 5.5 Download contract (async)
- New route:
  - `GET /api/v1/docx/jobs/:jobId/download`
- Rules:
  - `404`: job missing or not in workspace scope;
  - `409`: job not completed yet;
  - `422`: job failed;
  - `200`: DOCX binary.
- Download payload source:
  - job result metadata + rendered binary (stored by publishing worker policy for Wave 2).

### 5.6 Template registry contract
- Registry maps `templateId` to:
  - input validator;
  - data provider;
  - renderer strategy;
  - output filename strategy.
- Initial mappings:
  - `usecase-onepage` -> current one-page renderer;
  - `executive-synthesis-multipage` -> master-template renderer.

### 5.7 Security stance (synchronous removal)
- Synchronous DOCX routes are removed from production flow to prevent API saturation:
  - no direct binary rendering from request thread;
  - all document generation goes through publishing queue jobs.
- Legacy sync route `GET /api/v1/use-cases/:id/docx` is removed in Wave 2 implementation.

## 6. Master template requirements (executive synthesis)

### 6.1 File location
- `api/templates/executive-synthesis.docx`

### 6.2 Required markers
- `{{folder.name}}`
- `{{folder.executiveSummary.synthese_executive}}`
- `{{folder.executiveSummary.introduction}}`
- `{{folder.executiveSummary.analyse}}`
- `{{folder.executiveSummary.recommandation}}`
- Annex block (required when annex is enabled):
```txt
{{FOR uc IN (usecases || [])}}
{{INCLUDE template.usecase-onepage.docx WITH ($uc.data || $uc)}}
{{END-FOR uc}}
```

### 6.3 Optional markers
- `{{provided.dashboardImage}}` (resolved from `provided.dashboardImage.dataBase64` or `provided.dashboardImage.assetId`)
- `{{stats.totalUsecases}}`
- `{{stats.medianValue}}`
- `{{stats.medianComplexity}}`
- `{{stats.quickWinsCount}}`
- Dynamic copy markers only if needed:
  - `{{report.title}}`
  - `{{report.subtitle}}`
  - `{{report.year}}`
  - `{{annex.title}}`
  - `{{annex.subtitle}}`
  - `{{backCover.title}}`
  - `{{backCover.subtitle}}`
  - `{{backCover.p1}}`
  - `{{backCover.p2}}`
  - `{{backCover.p3}}`

### 6.4 Composition rules
- Annex insertion is defined by the location of the `FOR + INCLUDE` block in the master template.
- Dashboard image insertion occurs at `{{provided.dashboardImage}}` only when provided.
- Link/reference rendering must preserve current one-page behavior.
- Master template can iterate annex entries with existing loop syntax and inject use case blocks from `usecases`.
- References section uses as-is loop on folder data:
```txt
{{FOR ref IN (folder.execSummary.references || folder.executiveSummary.references || [])}}
{{$ref.link}}
{{END-FOR ref}}
```
- No hardcoded markdown list serialization in API for references; formatting is template-driven (list style/numbering in DOCX).

### 6.5 Mirror parity inventory (Dashboard print -> DOCX template)
- Cover:
  - report title + subtitle;
  - folder name;
  - executive summary block (`synthese_executive`).
- Dashboard synthesis pages:
  - stats (total use cases, median value/complexity, quick wins count);
  - dashboard visual (image provided by UI);
  - introduction, analysis, recommendation, references.
- TOC:
  - intro + analysis + recommendation + references + annex + use case entries.
- Annex:
  - annex separator page;
  - one iterated include of `usecase-onepage` per use case.
- Back cover:
  - title/subtitle and informational paragraphs.

### 6.6 Table of contents strategy (sommaire)
- TOC must rely on native Word TOC fields (not hardcoded page numbers in API).
- Master template must contain a TOC field configured to include heading styles (`Heading 1/2`).
- Renderer contract:
  - synthesis section titles must keep heading styles;
  - each annexed use case title must be inserted as heading style so it appears in TOC;
  - page breaks for annex entries follow template layout/style rules.
- Field update policy:
  - generated DOCX marks TOC fields as dirty and enables `updateFields`;
  - effective page-number refresh remains editor-dependent (Word/LibreOffice/Google Docs behavior differs);
  - operational policy for Wave 2: treat TOC refresh as a manual user action after opening the document.

## 7. Acceptance criteria for Lot 2.3.0
- Current model is documented and limitations are explicit.
- Functional templating objective is documented before endpoint details.
- Lifecycle and object articulation are defined.
- Unified endpoint and compatibility strategy are documented.
- Master template marker contract is documented.

## 8. Non-goals (this lot)
- No UI design workflow for templates.
- No final e2e/UAT execution in this spec.
- No full template governance UI/versioning workflow in this lot.

## 9. Template catalog per workspace type (BR-04B)

### 9.1 Extended template families

Current families (Wave 2):
- `usecase-onepage` (entity: initiative)
- `executive-synthesis-multipage` (entity: folder)

New families per workspace type:
- `opportunity-brief` (entity: initiative, type: opportunity, stage: G0-G2)
- `solution-proposal` (entity: solution, type: opportunity, stage: G2-G5)
- `bid-document` (entity: proposal, type: opportunity, stage: G5)
- `product-datasheet` (entity: product, type: any, stage: G5-G7)

### 9.2 Template x stage binding

Templates are available based on initiative maturity stage:
- Stage G0: `usecase-onepage`, `opportunity-brief`
- Stage G2: `solution-proposal`
- Stage G5: `bid-document`, `product-datasheet`
- Stage G7: `product-datasheet` (delivery documentation)

This binding is informational (UI suggests relevant templates), not enforced.

### 9.3 DOCX template stubs (BR-04B)

Stub DOCX templates added in `api/templates/`:
- `solution-summary.docx`
- `proposal-summary.docx` (renamed from `bid-summary.docx`)
- `product-datasheet.docx`

### 9.4 View template catalog alignment (BR-04B)

View templates (UI layout descriptors, distinct from DOCX templates) are now aligned with the agent/workflow pattern:
- DB is the source of truth (view templates are seeded per workspace type at workspace creation).
- Common templates (organization, dashboard, solution, product, proposal) are shared across all workspace types.
- Initiative template differs between ai-ideas and opportunity (different fields/tabs).
- Lazy-seed on `listViewTemplates()` ensures old workspaces get newly added templates.
- Config UX uses the shared `ConfigItemCard.svelte` component for agents, workflows, and view templates.
- See `SPEC_EVOL_CONFIG_UX_ALIGNMENT.md` for the mutualized config UX spec.
