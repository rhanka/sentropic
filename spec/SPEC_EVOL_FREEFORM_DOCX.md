# SPEC_EVOL — Freeform DOCX Generation (document_generate mode B.2)

Status: Implementation spec for BR-04B. Extends SPEC_TEMPLATING.md and SPEC_EVOL_WORKSPACE_TYPES.md §10.2.

## 1. Context

`document_generate` already exists as a chat tool, and the freeform engine already exists in [`generateFreeformDocx()`](../api/src/services/docx-generation.ts) plus [`docx-freeform-helpers.ts`](../api/src/services/docx-freeform-helpers.ts).

The broken behavior is only in the chat handler: the current `document_generate` branch returns a success-looking `tool_call_result` without generating a DOCX buffer, without uploading anything to S3, and without returning a working download target.

This spec fixes the `code` / freeform path only:
- `templateId` mode stays on its existing template-oriented behavior and is not redefined here.
- `code` mode must be synchronous end-to-end inside the chat handler.
- A freeform success result is valid only when the DOCX already exists in S3 and a working download URL already exists.

## 2. Tool contract

### 2.1 Template mode (unchanged)
```json
{
  "templateId": "usecase-onepage",
  "entityType": "initiative",
  "entityId": "xxx"
}
```

### 2.2 Upskill mode
```json
{
  "action": "upskill"
}
```
Returns the DOCX creation skill (rules, patterns, examples) in the tool result. The LLM reads it before generating code. No other parameters required.

### 2.3 Freeform mode
```json
{
  "action": "generate",
  "entityType": "folder",
  "entityId": "xxx",
  "code": "return doc([ h(1, 'Title'), p('Content...') ]);",
  "title": "Rapport initiatives dossier X"
}
```

### 2.4 Rules
- `action` is required: `"upskill"` or `"generate"`.
- For `action: "generate"`: `entityType` and `entityId` are required. Either `templateId` or `code` must be provided (mutually exclusive).
- For `action: "upskill"`: no other parameters needed.
- The tool description must instruct the LLM to call `upskill` before its first `generate` call in a conversation.
- `templateId` mode (existing) uses `action: "generate"` with `templateId` instead of `code`.
- Freeform copy/prompts/tool descriptions must not promise an async queue. The success contract is: the tool returns a ready-to-use download link.

## 3. Freeform helper API

### 3.1 Helpers actually exposed
The sandbox exposes these helpers from [`docx-freeform-helpers.ts`](../api/src/services/docx-freeform-helpers.ts):

| Helper | Signature | Notes |
| --- | --- | --- |
| `doc(children, opts?)` | `(blockChildren, { styles? }?)` | Returns a `Document` with default margins/styles/numbering |
| `h(level, text, opts?)` | `(1-6, string, { color?, align? }?)` | Heading paragraph |
| `p(text, opts?)` | `(string \| TextRun[], { align?, spacing?, indent? }?)` | Body paragraph |
| `bold(text)` | `(string)` | `TextRun` |
| `italic(text)` | `(string)` | `TextRun` |
| `list(items, opts?)` | `(string[], { ordered? }?)` | Returns `Paragraph[]` |
| `table(headers, rows, opts?)` | `(string[], string[][], { widths? }?)` | Returns `Table` |
| `pageBreak()` | `()` | Returns a paragraph with a page break |
| `hr()` | `()` | Returns a bottom-bordered paragraph |

Notes:
- There is no `section()` helper.
- There is no custom header/footer helper API in the current implementation.
- `doc()` is the canonical wrapper and the code must `return` a `Document`.

### 3.2 Raw `docx` exports
All named exports from `docx` are injected into the sandbox via `...docxLib`. Advanced code may use `Document`, `Paragraph`, `TextRun`, `Table`, `TableRow`, `TableCell`, `HeadingLevel`, `AlignmentType`, etc. directly.

### 3.3 Context object
The sandbox exposes:

```js
context.entity
context.initiatives
context.matrix
context.workspace
```

Rules:
- For `entityType: "initiative"`, `context.entity` is the hydrated initiative, `context.initiatives` is `[]`, and `context.matrix` comes from the initiative's folder.
- For `entityType: "folder"`, `context.entity` contains the folder summary (`id`, `name`, `description`, `executiveSummary`), `context.initiatives` contains the hydrated child initiatives, and `context.matrix` is the folder matrix.
- `context.workspace` currently contains `{ id: workspaceId }`.

### 3.4 Runtime constraints
- The code executes as `(function() { ...code... })()` inside `vm.Script`.
- Execution is synchronous, not async.
- Timeout is 30 seconds.
- The return value must be an actual `Document` instance.
- Only injected globals are available. No `require`, `import`, `process`, `fs`, network APIs, timers, or other Node runtime escape hatches are exposed.

## 4. Execution model

Freeform `document_generate` is synchronous inside [`chat-service.ts`](../api/src/services/chat-service.ts). Do not enqueue a `docx_generate` job for freeform mode.

### 4.1 Required handler flow
When `toolCall.name === "document_generate"` and `args.code` is present:

1. Validate inputs:
   - `entityType` must be `initiative` or `folder`
   - `entityId` must be non-empty
   - `templateId` and `code` remain mutually exclusive
   - if `code` is present, this spec applies
2. Call:
   ```ts
   await generateFreeformDocx({
     code,
     entityType,
     entityId,
     workspaceId: sessionWorkspaceId,
   })
   ```
3. Receive `{ fileName, mimeType, buffer }`.
4. Create a synchronous download record:
   - generate `jobId` in the chat handler
   - upload `buffer` to the documents bucket with the same key structure used by `processDocxGenerate()`
5. Persist a completed `docx_generate` row immediately so the existing download endpoint keeps working.
6. Emit a single success `tool_call_result` only after steps 2-5 have succeeded.

### 4.2 S3 storage key
Use the existing publishing pattern from [`processDocxGenerate()`](../api/src/services/queue-manager.ts):

```text
docx-cache/<workspaceId>/freeform/<entityType>/<entityId>/<jobId>.docx
```

Example:
```text
docx-cache/ws_123/freeform/folder/fld_456/job_789.docx
```

### 4.3 Persisted completed result
The synchronously-created `job_queue` row must be `type = 'docx_generate'`, `status = 'completed'`, and its `result` payload must match the download-compatible shape already used by `processDocxGenerate()`:

```json
{
  "state": "done",
  "progress": 100,
  "fileName": "freeform-folder-abcd1234.docx",
  "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "byteLength": 12345,
  "storageBucket": "documents-bucket",
  "storageKey": "docx-cache/ws_123/freeform/folder/fld_456/job_789.docx",
  "queueClass": "publishing",
  "completedAt": "2026-04-04T12:34:56.000Z"
}
```

This is required so [`GET /docx/jobs/:id/download`](../api/src/routes/api/docx.ts) can keep reading the file through `storageBucket` / `storageKey` with no route changes.

### 4.4 Tool result payload returned to chat
The success `tool_call_result` must be a real final result, not a placeholder:

```json
{
  "status": "completed",
  "mode": "freeform",
  "entityType": "folder",
  "entityId": "fld_456",
  "jobId": "job_789",
  "fileName": "Rapport initiatives dossier X.docx",
  "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "downloadUrl": "/docx/jobs/job_789/download"
}
```

Rules:
- `jobId` is the primary UI contract — the UI constructs the scoped download URL from it (same pattern as template mode: `withWorkspaceScope('/docx/jobs/{jobId}/download')`).
- `fileName` is displayed in the download card.
- Do not return `"queued"`, `"pending"`, or prose such as "will be available once processing completes".
- Do not call `queueManager.addJob()` for freeform mode.

## 5. UI rendering

[`StreamMessage.svelte`](../ui/src/lib/components/StreamMessage.svelte) must treat a `tool_call_result` from `document_generate` with a `jobId` as a first-class download action, not as plain text.

### 5.1 Detection
In the `tool_call_result` branch (line ~505), when `toolName === 'document_generate'`:
- `data.result.status === "completed"`
- `typeof data.result.jobId === "string"`
- `data.result.fileName` for display

### 5.2 Download card design
Render an inline card following the design system and standard chat file download patterns (ChatGPT/Claude.ai/Gemini style):

```
┌──────────────────────────────────────┐
│  📄  filename.docx                   │
│       DOCX                     ↓     │
└──────────────────────────────────────┘
```

Tailwind classes (from `rules/design-system.md`):
- Card: `rounded-lg border border-slate-200 bg-white shadow-sm px-4 py-3 flex items-center gap-3 max-w-xs`
- Icon: `FileText` from `@lucide/svelte`, `w-8 h-8 text-primary`
- File name: `text-sm font-medium text-slate-900 truncate`
- Type badge: `text-xs text-slate-500`
- Download button: `ml-auto text-primary hover:bg-slate-100 rounded p-2` with `Download` icon from lucide (`w-5 h-5`)

Do not:
- Dump raw JSON
- Show `jobId` or `mimeType` to the user
- Use full-width layout

### 5.3 Download behavior
On click, use the same browser download pattern from [`downloadCompletedDocxJob()`](../ui/src/lib/utils/docx.ts):
- Build scoped URL: `withWorkspaceScope('/docx/jobs/{jobId}/download')`
- Authenticated `fetch` with `credentials: 'include'`
- `blob()` → temporary object URL → `<a download>` click → cleanup
- Filename from `content-disposition` header, fallback to `result.fileName`

Do not use `waitForDocxJobCompletion()` or polling — the document is already completed.

### 5.4 No change to tool running state
While the tool executes (synchronous, up to 30s), the existing stream event flow applies as-is. No specific "Generating DOCX..." UI is added in this iteration. The standard tool-running presentation in StreamMessage is sufficient.

### 5.5 i18n
- Download button aria-label: `common.download` (existing key)
- No new i18n keys required — file name comes from the tool result

## 6. Error handling

Freeform errors are returned immediately in the same `tool_call_result`. There is no polling state machine for freeform mode.

### 6.1 Error payload
```json
{
  "status": "error",
  "code": "code_runtime_error",
  "error": "Paragraph is not defined"
}
```

### 6.2 Required mappings
- Preserve engine error codes from `generateFreeformDocx()` when available:
  - `code_syntax_error`
  - `code_runtime_error`
  - `code_timeout`
  - `invalid_return_type`
- Map missing entity/context loading failures to `not_found`.
- Map S3 upload or completed-row persistence failures to a storage/persistence error code.

### 6.3 Forbidden behaviors
- No success result before upload succeeds.
- No fake `"completed"` message with only explanatory prose.
- No async job-status instructions for the UI.
- No "download later" wording for freeform mode.

## 7. Upskill — DOCX creation skill

### 7.1 Purpose
The `upskill` action returns a self-contained skill document that teaches the LLM how to produce professional DOCX output. The LLM calls `document_generate({ action: "upskill" })` before its first freeform generation in a conversation. The skill is returned in the `tool_call_result` and consumed by the LLM as context for subsequent `generate` calls.

### 7.2 Tool description guidance
The `document_generate` tool description must include:
> "Before generating your first document in a conversation, call this tool with `action: 'upskill'` to learn DOCX best practices. Then call with `action: 'generate'` with your code."

### 7.3 Upskill result payload
```json
{
  "status": "completed",
  "mode": "upskill",
  "skill": "<skill content string>"
}
```

### 7.4 Skill content
The skill content returned by `upskill` is adapted from [anthropics/skills/docx](https://github.com/anthropics/skills/blob/main/skills/docx/SKILL.md), filtered for our sandbox context (no Python, no XML editing, no filesystem — only docx.js code generation executed in a `vm` sandbox).

The skill must cover:

#### 7.4.1 Setup & execution model
- Code is executed in a sandboxed `vm.createContext` with docx.js globals and helper functions
- The code must return a `Document` object (via `doc()` helper or `new Document({...})`)
- Available data: `context.entity`, `context.initiatives`, `context.matrix`, `context.workspace`
- Timeout: 30 seconds
- No `require`, `import`, `fs`, `fetch` — only the injected globals

#### 7.4.2 Page size (CRITICAL)
- Always set page size explicitly — docx.js defaults to A4
- US Letter: `width: 12240, height: 15840` (DXA, 1440 DXA = 1 inch)
- Standard margins: 1440 DXA (1 inch) on all sides
- Content width with 1" margins: 9360 DXA

#### 7.4.3 Styles (CRITICAL)
- Use `paragraphStyles` with exact built-in IDs: `"Heading1"`, `"Heading2"`, etc.
- Include `outlineLevel` for TOC compatibility (0 for H1, 1 for H2, etc.)
- Default font: Arial 12pt (universally supported)
- Keep titles black for readability
- Use named styles, not inline TextRun formatting for headings

#### 7.4.4 Tables (CRITICAL)
- **Tables need dual widths**: set both `columnWidths` on the table AND `width` on each cell
- **Always use `WidthType.DXA`** — never `WidthType.PERCENTAGE` (breaks in Google Docs)
- Table width = sum of columnWidths = content width (9360 DXA for US Letter with 1" margins)
- **Always add cell margins**: `margins: { top: 80, bottom: 80, left: 120, right: 120 }`
- **Use `ShadingType.CLEAR`** for table shading — never `SOLID` (causes black backgrounds)
- Cell margins are internal padding — they reduce content area, not add to cell width

Example:
```javascript
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
          children: [new Paragraph({ children: [new TextRun("Cell")] })]
        })
      ]
    })
  ]
})
```

#### 7.4.5 Lists (CRITICAL)
- **Never use unicode bullets** (`•`, `\u2022`) — use `LevelFormat.BULLET` with numbering config
- Each numbering `reference` creates independent numbering sequences
- Same reference = continues numbering; different reference = restarts

#### 7.4.6 Helpers available
- `doc(children, opts?)` — full Document with defaults (page size, margins, numbering)
- `h(level, text, opts?)` — heading (1-6)
- `p(text, opts?)` — paragraph
- `bold(text)`, `italic(text)` — inline formatting
- `list(items, opts?)` — bullet or ordered list
- `table(headers, rows, opts?)` — table with headers
- `pageBreak()`, `hr()` — structure
- Helpers accept `(Paragraph | Table)[]` — mix freely in `doc()`

#### 7.4.7 Other critical rules
- **Never use `\n`** — use separate Paragraph elements
- **PageBreak must be inside a Paragraph**
- **Use separate Paragraph elements for spacing** — not empty TextRuns
- For professional documents: use headers/footers, page numbers, consistent spacing
- For data-heavy documents: prefer tables with proper widths over bullet lists

### 7.5 System prompt change
Replace the current freeform docx system prompt block (chat-service.ts ~line 2932) with a short instruction:
```
## Document generation
You have the tool `document_generate`. Before generating your first DOCX in this conversation,
call it with `action: "upskill"` to learn professional DOCX creation rules.
Then call with `action: "generate"` and your code.
```
This is much shorter than the current block and does not leak the full skill into every system prompt.
