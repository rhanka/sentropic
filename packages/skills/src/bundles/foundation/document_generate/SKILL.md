---
name: document_generate
description: Generate documents (DOCX, PPTX) from the chat context. Routes freeform sandbox code through the V8 host bridge, or invokes an injected DOCX template renderer.
version: 0.1.0
category: document
sandbox:
  surface:
    - files.create
  timeoutMs: 30000
  memoryMb: 128
tools:
  - name: document_generate
    description: |
      Generate a document from the current context (organization, initiative, folder/dashboard, etc.).
      Formats: "docx" (default) or "pptx".
      DOCX supports two sub-modes — (1) Template mode with templateId, (2) Freeform mode with code (mutually exclusive).
      PPTX supports freeform code only.
      The sandbox helper API surface (helpers, layout rules, full examples) lives in this SKILL.md below — discoverable via `search_skills`.
    inputSchema:
      type: object
      properties:
        action:
          type: string
          enum: [generate]
          description: Action to perform. Only "generate" is supported.
        format:
          type: string
          enum: [docx, pptx]
          description: Output format. Defaults to "docx". Use "pptx" for freeform presentation generation (PptGenJS code).
        templateId:
          type: string
          description: Document template identifier. Examples; "usecase-onepage" for initiative one-pager, "executive-synthesis-multipage" for folder executive summary report. Mutually exclusive with code. Only for action "generate" and format "docx". Template mode requires an initiative or folder target.
        entityType:
          type: string
          enum: [organization, initiative, folder]
          description: Optional freeform target type. Omit in freeform mode when the current chat context already focuses an organization, initiative, or folder. Template mode only supports "initiative" or "folder".
        entityId:
          type: string
          description: Optional freeform target ID. Omit in freeform mode when the current chat context already focuses the target. Template mode requires the ID of a template-compatible initiative or folder unless the current context already provides it.
        code:
          type: string
          description: Freeform JavaScript code. For format "docx", use docx helpers (doc, h, p, bold, italic, list, table, pageBreak, hr) and return a Document object. For format "pptx", prefer pptx() plus the provided PptGenJS helpers and return a presentation object. Available data; context.entity, context.folders, context.initiatives, context.matrix, context.workspace. Mutually exclusive with templateId. Only for action "generate".
        title:
          type: string
          description: Document title used as the file name. Example; "Rapport initiatives dossier X". Only for action "generate".
      required: [action]
    sideEffect: true
    requiresApproval: false
---

# Document generate skill

The `document_generate` skill produces user-facing documents (DOCX and PPTX)
from the chat context. It supports three execution sub-paths.

## Freeform DOCX via V8 sandbox (bound — Wave D step 1.A)

When `action=generate`, `format=docx`, and `code` is provided (with no
`templateId`), the handler executes the user-supplied JavaScript inside the
`SandboxRuntime` V8 isolate. The host installs a docx bridge that exposes the
same helpers as the legacy `getSandboxGlobals` runtime — `doc`, `h`, `p`,
`bold`, `italic`, `list`, `table`, `pageBreak`, `hr` — with byte-stable output
vs the legacy `generateFreeformDocx`. The final paragraph/document handle
returned by the script is packed via `docx.Packer.toBuffer` host-side and
surfaced through `files.create`.

## Freeform PPTX via V8 sandbox (bound — Wave D step 1.B)

When `action=generate`, `format=pptx`, and `code` is provided, the handler
executes the user-supplied JavaScript inside the `SandboxRuntime` V8 isolate
behind a `pptx-host-bridge` symmetric with the DOCX bridge. The host exposes
PptGenJS helpers — `pptx`, `titleSlide`, `sectionSlide`, `textBox`, `bullets`,
`table`, `statCallout`, `footer`, `visualPlaceholder`, `safeText` — and raw
`PptxGenJS` / `pptxgenjs` for advanced APIs, with byte-stable output vs the
legacy `generateFreeformPptx`. The deck handle returned by the script is
serialised host-side and surfaced through `files.create`.

## Template DOCX via injected renderer (deferred binding — BR19-N3)

When `action=generate`, `format=docx`, and `templateId` is set (without
`code`), the handler calls `caller.templateRenderer.renderTemplate(...)`.
The adapter is injected by `chat-service` at the closing Wave D commit
(BR19-D3), wrapping the legacy `generateDocxForEntity` to load workspace,
initiative, or folder records from the DB and render an in-template document.
If `caller.templateRenderer == null`, the handler throws a clear
`templateRenderer not bound` error.

# DOCX sandbox helpers (API surface)

## 1. Setup & execution model

Your code runs inside a sandboxed `vm.createContext` with docx.js globals and helper functions.
- The code must `return` a `Document` object (via `doc()` helper or `new Document({...})`).
- Available data: `context.entity`, `context.folders`, `context.initiatives`, `context.matrix`, `context.workspace`.
- Timeout: 30 seconds.
- No `require`, `import`, `fs`, `fetch`, `process` — only the injected globals.
- Code is wrapped as `(function() { ...your code... })()` and executed synchronously.

## 2. Page size (CRITICAL)

Always set page size explicitly — docx.js defaults to A4.
- US Letter: width = 12240, height = 15840 (DXA units, 1440 DXA = 1 inch)
- Standard margins: 1440 DXA (1 inch) on all sides
- Content width with 1" margins: 9360 DXA

The `doc()` helper already sets US Letter page size and 1" margins by default.

## 3. Styles (CRITICAL)

- The `doc()` helper defines `paragraphStyles` with exact built-in IDs: `"Heading1"`, `"Heading2"`, `"Heading3"`.
- These include `outlineLevel` for TOC compatibility (0 for H1, 1 for H2, 2 for H3).
- Default font: Arial 12pt (universally supported).
- Use the `h(level, text)` helper for headings — it references the named styles, no inline overrides needed.
- Keep titles black for readability.
- Do NOT set inline font/size/color/bold on heading TextRuns — the style handles it.

## 4. Tables (CRITICAL)

Tables need dual widths: set both `columnWidths` on the table AND `width` on each cell.

Rules:
- **Always use `WidthType.DXA`** — never `WidthType.PERCENTAGE` (breaks in Google Docs).
- Table width = sum of columnWidths = content width (9360 DXA for US Letter with 1" margins).
- **Always add cell margins**: `margins: { top: 80, bottom: 80, left: 120, right: 120 }`
- **Use `ShadingType.CLEAR`** for table shading — never `SOLID` (causes black backgrounds).
- Cell margins are internal padding — they reduce content area, not add to cell width.

Example using raw docx classes:
```javascript
const border = { style: BorderStyle.SINGLE, size: 1, color: 'cbd5e1' };
new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [4680, 4680],
  rows: [
    new TableRow({
      children: [
        new TableCell({
          borders: { top: border, bottom: border, left: border, right: border },
          width: { size: 4680, type: WidthType.DXA },
          shading: { fill: "D5E8F0", type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun("Header")] })]
        }),
        new TableCell({
          borders: { top: border, bottom: border, left: border, right: border },
          width: { size: 4680, type: WidthType.DXA },
          shading: { fill: "D5E8F0", type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun("Header 2")] })]
        })
      ]
    })
  ]
})
```

The `table(headers, rows, opts?)` helper handles all of this automatically with proper defaults.

## 5. Lists (CRITICAL)

- **Never use unicode bullets** (`•`, `●`) — use `LevelFormat.BULLET` with numbering config.
- The `doc()` helper pre-configures numbering references: `"freeform-bullet"` and `"freeform-ordered"`.
- The `list(items, { ordered? })` helper uses these references automatically.
- Each numbering `reference` creates independent numbering sequences.
- Same reference = continues numbering; different reference = restarts.

## 6. Helpers available

| Helper | Signature | Notes |
|--------|-----------|-------|
| `doc(children, opts?)` | `((Paragraph \| Table)[], { styles? }?)` | Full Document with US Letter, margins, numbering, paragraph styles |
| `h(level, text, opts?)` | `(1-6, string, { color?, align? }?)` | Heading paragraph (uses named styles) |
| `p(text, opts?)` | `(string \| TextRun[], { align?, spacing?, indent? }?)` | Body paragraph |
| `bold(text)` | `(string)` | Bold TextRun |
| `italic(text)` | `(string)` | Italic TextRun |
| `list(items, opts?)` | `(string[], { ordered? }?)` | Bullet or ordered list (returns Paragraph[]) |
| `table(headers, rows, opts?)` | `(string[], string[][], { widths? }?)` | Table with proper DXA widths, cell margins, ShadingType.CLEAR |
| `pageBreak()` | `()` | Paragraph with page break |
| `hr()` | `()` | Horizontal rule (bottom-bordered paragraph) |

Helpers accept `(Paragraph | Table)[]` — mix freely in `doc()`.

All raw `docx` classes are also available: `Document`, `Paragraph`, `TextRun`, `Table`, `TableRow`, `TableCell`, `HeadingLevel`, `AlignmentType`, `WidthType`, `ShadingType`, `BorderStyle`, `LevelFormat`, etc.

## 7. Other critical rules

- **Never use \n in text** — use separate Paragraph elements for new lines.
- **PageBreak must be inside a Paragraph** — use `pageBreak()` helper.
- **Use separate Paragraph elements for spacing** — not empty TextRuns.
- For professional documents: use consistent spacing, clear section headings, and tables for structured data.
- For data-heavy documents: prefer tables with proper widths over bullet lists.
- Always provide a descriptive `title` parameter for the download file name.

## 8. Complete example

```javascript
const entity = context.entity;
const initiatives = context.initiatives;

return doc([
  h(1, entity.name || "Report"),
  p(entity.description || "No description available."),

  h(2, "Initiatives Overview"),
  table(
    ["Name", "Status", "Description"],
    initiatives.map(i => [
      i.data?.name || "Untitled",
      i.data?.status || "N/A",
      (i.data?.description || "").substring(0, 100)
    ])
  ),

  pageBreak(),

  h(2, "Detailed Analysis"),
  ...initiatives.flatMap(i => [
    h(3, i.data?.name || "Untitled"),
    p(i.data?.description || "No description."),
    ...(i.data?.keyBenefits ? list(i.data.keyBenefits) : []),
  ]),

  hr(),
  p("Report generated automatically."),
]);
```

# PPTX sandbox helpers (API surface)

## 1. Execution model

Your code runs inside a sandboxed Node VM with PptGenJS helpers.
- Return a PptGenJS presentation object from `pptx()`.
- Prefer `pptx()` over raw constructor calls; use `PptxGenJS` / `pptxgenjs` only for advanced APIs not covered by the helpers.
- You may also return `{ presentation, fileName }`.
- Available data: `context.entity`, `context.folders`, `context.initiatives`, `context.matrix`, `context.workspace`.
- Timeout: 30 seconds for code execution.
- No `require`, `import`, `fs`, `fetch`, `process`, network, or template import/editing.
- Use inches for coordinates. Wide slides are 13.333 x 7.5 inches.

## 2. Recommended workflow

1. Create a presentation with `const deck = pptx({ title: "..." })`.
2. Add a title slide and section slides before dense content.
3. Build each slide with explicit `x`, `y`, `w`, and `h` values.
4. Prefer visual structure: tables, callouts, comparisons, timelines, and placeholders.
5. Return `deck` only after all slides are added.

## 3. Helpers available

| Helper | Purpose |
| --- | --- |
| `pptx(opts?)` | Preferred presentation factory with wide layout, default fonts, metadata |
| `titleSlide(deck, title, subtitle?, opts?)` | Cover slide |
| `sectionSlide(deck, title, subtitle?, opts?)` | Section divider |
| `textBox(slide, text, opts)` | Stable text box with shrink fit |
| `bullets(slide, items, opts)` | Bullet list using PowerPoint bullets |
| `table(slide, headers, rows, opts)` | Table with styled header and borders |
| `statCallout(slide, label, value, opts)` | Metric/callout card |
| `footer(slide, text, opts?)` | Small footer text |
| `visualPlaceholder(slide, label, opts)` | Explicit image/diagram placeholder |
| `safeText(value, fallback?)` | Defensive text coercion |

Raw `PptxGenJS` / `pptxgenjs` is also available for advanced PptGenJS APIs, but prefer `pptx()` first.

## 4. Layout rules

- Always use explicit coordinates. Do not rely on implicit placement.
- Keep text inside boxes; set `fit: "shrink"` when text length is uncertain.
- Use 0.6-0.8 inch outside margins on most slides.
- Titles usually fit in y=0.45..1.0, content starts around y=1.25.
- Body font sizes: 14-18 pt. Captions: 8-11 pt. Titles: 26-36 pt.
- Avoid text-only decks. Every slide should have a visible structure.
- Use a restrained palette: dark text, one accent, light fills.
- Do not fake bullets with characters; use `bullets()` or PptGenJS bullet options.
- Do not include external images or remote assets in BR-21a.

## 5. Complete example

```javascript
const deck = pptx({ title: context.entity.name || "Generated presentation" });

titleSlide(deck, context.entity.name || "Generated presentation", context.entity.description);

sectionSlide(deck, "Portfolio overview", "Current initiatives and expected value");
let slide = deck.addSlide();
textBox(slide, "Initiatives", {
  x: 0.7, y: 0.45, w: 7.5, h: 0.45, fontSize: 26, bold: true
});
table(
  slide,
  ["Name", "Status", "Summary"],
  (context.initiatives || []).slice(0, 6).map((item) => [
    item.data?.name || "Untitled",
    item.status || "n/a",
    item.data?.description || ""
  ]),
  { x: 0.7, y: 1.25, w: 8.4, fontSize: 10.5 }
);
statCallout(slide, "Initiatives", String((context.initiatives || []).length), {
  x: 9.55, y: 1.25, w: 2.7
});
visualPlaceholder(slide, "Add a workflow or matrix visual", {
  x: 9.55, y: 2.9, w: 2.7, h: 2.1
});
footer(slide, "Generated by Sentropic");

return deck;
```
