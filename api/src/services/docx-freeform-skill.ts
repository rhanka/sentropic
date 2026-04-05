/**
 * DOCX creation skill content for the upskill action.
 *
 * This is a TEXT document that the LLM reads to learn how to produce
 * professional DOCX output in our sandbox. It is NOT executable code.
 *
 * Adapted from anthropics/skills/docx for our vm sandbox context.
 * See spec/SPEC_EVOL_FREEFORM_DOCX.md §7.4 for requirements.
 */

export function getDocxFreeformSkill(): string {
  return `# DOCX Creation Skill — Sandbox Reference

## 1. Setup & Execution Model

Your code runs inside a sandboxed \`vm.createContext\` with docx.js globals and helper functions.
- The code must \`return\` a \`Document\` object (via \`doc()\` helper or \`new Document({...})\`).
- Available data: \`context.entity\`, \`context.initiatives\`, \`context.matrix\`, \`context.workspace\`.
- Timeout: 30 seconds.
- No \`require\`, \`import\`, \`fs\`, \`fetch\`, \`process\` — only the injected globals.
- Code is wrapped as \`(function() { ...your code... })()\` and executed synchronously.

## 2. Page Size (CRITICAL)

Always set page size explicitly — docx.js defaults to A4.
- US Letter: width = 12240, height = 15840 (DXA units, 1440 DXA = 1 inch)
- Standard margins: 1440 DXA (1 inch) on all sides
- Content width with 1" margins: 9360 DXA

The \`doc()\` helper already sets US Letter page size and 1" margins by default.

## 3. Styles (CRITICAL)

- The \`doc()\` helper defines \`paragraphStyles\` with exact built-in IDs: \`"Heading1"\`, \`"Heading2"\`, \`"Heading3"\`.
- These include \`outlineLevel\` for TOC compatibility (0 for H1, 1 for H2, 2 for H3).
- Default font: Arial 12pt (universally supported).
- Use the \`h(level, text)\` helper for headings — it references the named styles, no inline overrides needed.
- Keep titles black for readability.
- Do NOT set inline font/size/color/bold on heading TextRuns — the style handles it.

## 4. Tables (CRITICAL)

Tables need dual widths: set both \`columnWidths\` on the table AND \`width\` on each cell.

Rules:
- **Always use \`WidthType.DXA\`** — never \`WidthType.PERCENTAGE\` (breaks in Google Docs).
- Table width = sum of columnWidths = content width (9360 DXA for US Letter with 1" margins).
- **Always add cell margins**: \`margins: { top: 80, bottom: 80, left: 120, right: 120 }\`
- **Use \`ShadingType.CLEAR\`** for table shading — never \`SOLID\` (causes black backgrounds).
- Cell margins are internal padding — they reduce content area, not add to cell width.

Example using raw docx classes:
\`\`\`javascript
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
\`\`\`

The \`table(headers, rows, opts?)\` helper handles all of this automatically with proper defaults.

## 5. Lists (CRITICAL)

- **Never use unicode bullets** (\`\\u2022\`, \`\\u25CF\`) — use \`LevelFormat.BULLET\` with numbering config.
- The \`doc()\` helper pre-configures numbering references: \`"freeform-bullet"\` and \`"freeform-ordered"\`.
- The \`list(items, { ordered? })\` helper uses these references automatically.
- Each numbering \`reference\` creates independent numbering sequences.
- Same reference = continues numbering; different reference = restarts.

## 6. Helpers Available

| Helper | Signature | Notes |
|--------|-----------|-------|
| \`doc(children, opts?)\` | \`((Paragraph \\| Table)[], { styles? }?)\` | Full Document with US Letter, margins, numbering, paragraph styles |
| \`h(level, text, opts?)\` | \`(1-6, string, { color?, align? }?)\` | Heading paragraph (uses named styles) |
| \`p(text, opts?)\` | \`(string \\| TextRun[], { align?, spacing?, indent? }?)\` | Body paragraph |
| \`bold(text)\` | \`(string)\` | Bold TextRun |
| \`italic(text)\` | \`(string)\` | Italic TextRun |
| \`list(items, opts?)\` | \`(string[], { ordered? }?)\` | Bullet or ordered list (returns Paragraph[]) |
| \`table(headers, rows, opts?)\` | \`(string[], string[][], { widths? }?)\` | Table with proper DXA widths, cell margins, ShadingType.CLEAR |
| \`pageBreak()\` | \`()\` | Paragraph with page break |
| \`hr()\` | \`()\` | Horizontal rule (bottom-bordered paragraph) |

Helpers accept \`(Paragraph | Table)[]\` — mix freely in \`doc()\`.

All raw \`docx\` classes are also available: \`Document\`, \`Paragraph\`, \`TextRun\`, \`Table\`, \`TableRow\`, \`TableCell\`, \`HeadingLevel\`, \`AlignmentType\`, \`WidthType\`, \`ShadingType\`, \`BorderStyle\`, \`LevelFormat\`, etc.

## 7. Other Critical Rules

- **Never use \\n in text** — use separate Paragraph elements for new lines.
- **PageBreak must be inside a Paragraph** — use \`pageBreak()\` helper.
- **Use separate Paragraph elements for spacing** — not empty TextRuns.
- For professional documents: use consistent spacing, clear section headings, and tables for structured data.
- For data-heavy documents: prefer tables with proper widths over bullet lists.
- Always provide a descriptive \`title\` parameter for the download file name.

## 8. Complete Example

\`\`\`javascript
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
\`\`\`
`;
}
