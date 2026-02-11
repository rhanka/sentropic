# SPEC - DOCX Templating

## 1. Purpose

### 1.1 Functional objective
Provide a template-driven DOCX generation capability for two business documents:
- use case one-page report;
- executive synthesis multipage report with annexed use cases.

The primary concern is functional templating (layout control, marker contract, lifecycle), not endpoint design alone.

### 1.2 Expected product behavior
- Document layout is controlled by `.docx` templates, not hardcoded chapter order.
- Business users can evolve templates without rewriting rendering logic each time.
- Annex and dashboard placement are explicitly controlled by template markers.
- Existing use case one-page export remains available during migration.

### 1.3 Scope for Wave 2 (Lot 2.3)
- Define functional contract and lifecycle for templating.
- Define template/data articulation for use case and executive synthesis documents.
- Define API support model (unified endpoint, compatibility wrapper, renderer registry).

Out of scope in this spec:
- UI template designer.
- Full governance workflow (draft/approval/versioning UI) implementation.

## 2. Functional model

### 2.1 Templated document families
- `usecase-onepage`
  - Source entity: `usecase`.
  - Output: one-page document.
  - Current implementation exists and is the migration baseline.
- `executive-synthesis-multipage`
  - Source entity: `folder`.
  - Output: multipage synthesis with optional annex and optional dashboard visual.

### 2.2 Functional sections
- Use case one-page sections:
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
- `usecase-onepage` template binds to `use_cases` (+ folder matrix context when needed).
- `executive-synthesis-multipage` template binds to:
  - `folders` (executive summary source);
  - linked `use_cases` (annex source);
  - optional dashboard payload from client provided data.

### 3.3 Intake bundle for executive synthesis (single lock point)
- Required:
  - `executive-synthesis.docx` master template.
  - annex intent:
    - append use cases: yes/no;
    - new page per use case: yes/no.
  - dashboard intent:
    - include dashboard image: yes/no.
  - one reference UAT dataset:
    - folder id containing executive summary + multiple use cases.

### 3.4 Compatibility and fallback policy
- Missing required marker -> contract error (`422`).
- Optional marker missing:
  - if optional section is disabled, no error;
  - if optional section is enabled but marker missing, return contract error (`422`).
- One-page route remains available as compatibility wrapper during migration.

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
  - `controls` (annex/toc/page-break behavior)
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

### 4.3 Include contract for annex use cases
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

### 5.1 Current model (as-is)
- Existing route: `GET /api/v1/use-cases/:id/docx`
- Existing renderer path:
  - `api/src/services/docx-service.ts`
  - template loading from `api/templates`
  - placeholder patching with `dolanmiu/docx` and XML loop expansion.

Current limitations:
- one endpoint per document type;
- use case scope only;
- no shared template registry/validation layer.

### 5.2 Target support model
- Unified generation endpoint:
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
  - `controls`: render choices (annex mode, toc mode, page breaks, sub-template ref);
  - `options`: deprecated alias accepted temporarily for backward compatibility.
- Response contract:
  - success: DOCX binary stream;
  - errors:
    - `400` invalid payload;
    - `404` entity not found (workspace scoped);
    - `422` template/rendering contract error.

### 5.3 Template registry contract
- Registry maps `templateId` to:
  - input validator;
  - data provider;
  - renderer strategy;
  - output filename strategy.
- Initial mappings:
  - `usecase-onepage` -> current one-page renderer;
  - `executive-synthesis-multipage` -> master-template renderer.

### 5.4 Backward compatibility
- Keep `GET /api/v1/use-cases/:id/docx` temporarily.
- Wrapper delegates internally to unified generation with:
  - `templateId=usecase-onepage`
  - `entityType=usecase`
  - `entityId=:id`

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
{{FOR ref IN (folder.executiveSummary.references || [])}}
{{$ref.title}} {{$ref.url}}
{{END-FOR ref}}
```

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
  - page breaks for annex entries follow selected annex intent.
- Field update policy:
  - generated DOCX enables "update fields on open" behavior;
  - UAT validates that opening the document updates TOC entries and page numbers.

## 7. Acceptance criteria for Lot 2.3.0
- Current model is documented and limitations are explicit.
- Functional templating objective is documented before endpoint details.
- Lifecycle and object articulation are defined.
- Unified endpoint and compatibility strategy are documented.
- Master template marker contract is documented.

## 8. Non-goals (this lot)
- No UI design workflow for templates.
- No final e2e/UAT execution in this spec.
- No removal of legacy one-page route in this lot.
