---
name: document_generate
description: Generate documents (DOCX, PPTX) from the chat context. Supports upskill curriculum, template renderers, and freeform sandbox code via the V8 host bridge.
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
      Generate a document from the current context (initiative, folder/dashboard, etc.).
      Formats: "docx" (default) or "pptx".
      Before generating your first document in a conversation, call this tool with `action: "upskill"` (optionally with format) to learn best practices.
      Then call with `action: "generate"`.
      DOCX supports two sub-modes — (1) Template mode with templateId, (2) Freeform mode with code (mutually exclusive).
      PPTX supports freeform code only.
    inputSchema:
      type: object
      properties:
        action:
          type: string
          enum: [upskill, generate]
          description: Action to perform. Call "upskill" first to learn DOCX creation best practices, then "generate" with your code.
        format:
          type: string
          enum: [docx, pptx]
          description: Output format. Defaults to "docx". Use "pptx" for freeform presentation generation (PptGenJS code).
        templateId:
          type: string
          description: Document template identifier. Examples; "usecase-onepage" for initiative one-pager, "executive-synthesis-multipage" for folder executive summary report. Mutually exclusive with code. Only for action "generate" and format "docx".
        entityType:
          type: string
          enum: [initiative, folder]
          description: Type of entity to generate the document for. Only for action "generate". Optional when the current chat context already focuses an initiative or folder.
        entityId:
          type: string
          description: ID of the entity (initiative ID or folder ID). Only for action "generate". Optional when the current chat context already focuses the target initiative/folder.
        code:
          type: string
          description: Freeform JavaScript code. For format "docx", use docx helpers (doc, h, p, bold, italic, list, table, pageBreak, hr) and return a Document object. For format "pptx", prefer pptx() plus the provided PptGenJS helpers and return a presentation object. Available data; context.entity, context.initiatives, context.matrix, context.workspace. Mutually exclusive with templateId. Only for action "generate".
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

## Other sub-paths (deferred — Wave D step 1.B/1.C)

The remaining sub-paths — `format=pptx` freeform code, `action=generate` with
`templateId` (template renderers like `usecase-onepage` and
`executive-synthesis-multipage`), and `action=upskill` curriculum text — are
NOT bound yet. The handler throws a `deferred sub-path` error for any of
those; legacy `api/src/services/chat-service.ts` dispatch retains coverage
until BR-19 Wave D step 1.B (PPTX) and step 1.C (upskill + template) port them
onto `SandboxRuntime` and the closing Wave D commit (BR19-D3) atomically
rebinds chat-service.
