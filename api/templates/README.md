# DOCX Templates

This directory contains `.docx` templates used by the DOCX export service.

## Runtime

- Engine: `dolanmiu/docx` (`patchDocument`)
- Placeholders: `{{ ... }}`
- Loop syntax supported by the service: `{{FOR item IN (...)}} ... {{END-FOR item}}`
- Template source: `word/document.xml` inside `usecase-onepage.docx`

## Markdown rendering

Markdown is converted server-side to styled Word runs (bold/italic/strike, line
breaks, simple bullets) before patching placeholders in the template.

## Template authoring constraints

1. Keep placeholders as complete tokens (do not split a placeholder across runs).
2. Keep loop markers on their own lines/paragraphs.
3. Keep loop variables with `$` access, for example: `{{$ax.title}}`.
4. Keep marker names stable: marker names are runtime contract keys.
5. Do not manually type page numbers in templates.

## Template families

### `usecase-onepage.docx`

Typical markers:
- Scalars: `{{name}}`, `{{description}}`, `{{problem}}`, `{{solution}}`
- Loops: `{{FOR benefit IN (benefits || [])}} ... {{END-FOR benefit}}`
- Loop variable access: `{{$benefit}}`, `{{$ax.title}}`, `{{$ref.link}}`

### `executive-synthesis.docx` (target)

Marker sequence (exact as-is print order):
1. Cover page:
   - `{{report.title}}`
   - `{{folder.name}}`
   - `{{folder.executiveSummary.synthese_executive}}`
2. Dashboard synthesis page:
   - `{{stats.totalUsecases}}`
   - `{{stats.medianValue}}`
   - `{{stats.medianComplexity}}`
   - `{{stats.quickWinsCount}}`
   - `{{provided.dashboardImage}}` (resolved from `provided.dashboardImage.dataBase64` or `provided.dashboardImage.assetId`)
   - `{{folder.executiveSummary.introduction}}`
3. TOC page:
   - native Word TOC field (Heading 1..2)
4. Analysis page:
   - `{{folder.executiveSummary.analyse}}`
5. Recommendation page:
   - `{{folder.executiveSummary.recommandation}}`
6. References page:
```txt
{{FOR ref IN (folder.execSummary.references || folder.executiveSummary.references || [])}}
{{$ref.link}}
{{END-FOR ref}}
```
Notes:
- `ref.link` is the Markdown hyperlink form (`[title](url)`) rendered as a clickable DOCX hyperlink.
- Numbering/bullets must come from paragraph/list style in the template (recommended), not hardcoded API formatting.
7. Annex separator page:
   - `{{annex.title}}`
   - `{{annex.subtitle}}`
8. Annex iterated use case pages:
```txt
{{FOR uc IN (usecases || [])}}
{{INCLUDE template.usecase-onepage.docx WITH ($uc.data || $uc)}}
{{END-FOR uc}}
```
9. Back cover:
   - `{{backCover.title}}`
   - `{{backCover.subtitle}}`
   - `{{backCover.p1}}`
   - `{{backCover.p2}}`
   - `{{backCover.p3}}`

Include semantics:
- If `uc.data` exists, included template root context is `uc.data`.
- Otherwise, included template root context is `uc`.
- This keeps existing one-page markers unchanged (`{{name}}`, `{{description}}`, loops, etc.).

Mirror parity checklist (dashboard print -> DOCX template):
1. Cover (title/subtitle + folder name + executive summary block).
2. Dashboard synthesis content (stats + image + introduction/analyse/recommandation/references).
3. TOC section.
4. Annex separator page.
5. Annex iteration (one included `usecase-onepage` per use case).
6. Back cover content.

Input bundle to provide before implementation:
1. `executive-synthesis.docx` with all required markers and sections above.
2. TOC mode decision: `word_field` (recommended) or `static`.
3. Annex decision: include annex section (`true`/`false`).
4. Annex pagination rule in template:
  - Use template layout/styling to control page breaks (recommended: set `Page break before` on the first paragraph/title in `usecase-onepage.docx`).
5. Dashboard image transport mode and key:
  - inline (`provided.dashboardImage.dataBase64`) or
  - managed asset (`provided.dashboardImage.assetId`),
  - rendered in template via `{{provided.dashboardImage}}`.

## TOC (table of contents) authoring

Use a native Word TOC field. Do not emulate TOC with manual text.

Required style contract:
- Synthesis sections: `Heading 1`
- Annex use case title: `Heading 2` (one per annexed use case)

TOC behavior:
- TOC must include at least levels `Heading 1..2`
- Page numbers are updated by field update, not by template editing
- Runtime note (current): the API marks TOC fields as dirty and sets
  `updateFields`, but page-number refresh is editor-dependent and not guaranteed
  automatically. Treat TOC refresh as a user action.

Field update:
- In Word: `Ctrl+A`, then `F9`, then "Update entire table"
- In LibreOffice: update indexes/tables before validation

## Editor compatibility (authoring tools)

### Microsoft Word (recommended)
- Best fidelity for TOC fields, heading styles, and DOCX XML preservation.

### LibreOffice (acceptable)
- Works for most marker edits and heading styles.
- Validate that TOC remains a real index field after save/export.
- Re-check loop markers are still single tokens after editing.

### Google Docs (supported with constraints)
- Good for content drafting and heading structure.
- Export to `.docx` can alter Word-specific field behavior (TOC often needs normalization).

Recommended Google Docs workflow:
1. Author content with `Heading 1/2` and marker tokens (`{{...}}`) only.
2. Keep loop markers on dedicated lines.
3. Export as `.docx`.
4. Open exported file in Word or LibreOffice and normalize:
   - ensure TOC is a real field/index;
   - ensure headings are preserved;
   - ensure markers were not split or transformed.
5. Save and validate with one real generation run before delivery.

## Validation checklist before committing a template

1. Required markers exist for the targeted template family.
2. TOC is native field/index (not static text).
3. Heading styles are correctly applied for TOC levels.
4. No marker split across runs.
5. Loop markers and loop variable paths are intact.
