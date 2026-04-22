# BR-21a Brainstorm - PptGenJS Tool Call

Status: Brainstorming before specification. This is not an implementation spec.

Owner branch: `feat/pptxgenjs-tool-21a`.

## Product Principle

Accepted principle:

- BR-21a adds one more chat tool call for PowerPoint generation.
- The generated PPTX must appear in chat as another generated file type, next to the existing DOCX generation behavior.
- The branch is profile-neutral and must not introduce CV/profile concepts.
- Implementation must not start until the Q&A below is answered and a real `spec/SPEC_EVOL_PPTXGENJS_TOOL.md` is written from the validated answers.

## Reference Behavior

Existing reference:

- `document_generate` can generate DOCX files from chat.
- The UI already knows how to expose generated DOCX files as downloadable chat artifacts.
- BR-21a should extend that product pattern for PPTX, not create a separate profile/export workflow.

## Q&A To Validate

### Q1 - Tool Name

Question: What should the new chat tool be called?

- 1A (recommended): `presentation_generate`
- 1B: `pptx_generate`
- 1C: `slide_generate`

Tradeoff:

- `presentation_generate` is user-facing and can still return `.pptx`.
- `pptx_generate` is more technical but unambiguous.
- `slide_generate` is shorter but can sound like single-slide only.

### Q2 - Relationship With `document_generate`

Question: Should PPTX be a separate tool call or a mode of `document_generate`?

- 2A (recommended): Separate tool call.
- 2B: Add `format: "pptx"` to `document_generate`.

Tradeoff:

- Separate tool call keeps DOCX behavior stable and matches the user's product direction.
- A shared tool would reduce API surface but risks making `document_generate` too broad.

### Q3 - Generated File Card

Question: How should the chat UI represent generated PPTX files?

- 3A (recommended): Generalize the existing generated-file card so DOCX and PPTX use the same UI pattern.
- 3B: Add a PPTX-specific card beside the DOCX card.

Tradeoff:

- Generalizing avoids duplicate UI logic and prepares future generated file types.
- A PPTX-specific card may be faster if current DOCX UI is hardcoded.

### Q4 - Generation Contract

Question: Should the LLM generate executable PptGenJS code, like freeform DOCX does with docx.js?

- 4A (recommended): Yes, sandboxed PptGenJS code generation.
- 4B: No, LLM emits a JSON slide descriptor and backend renders it.

Tradeoff:

- Sandboxed PptGenJS is closest to current DOCX architecture and likely fastest.
- A JSON descriptor could be more controlled but requires designing a slide layout DSL first.

### Q5 - Upskill Flow

Question: Should the tool have an `upskill` action before generation?

- 5A (recommended): Yes, same pattern as DOCX.
- 5B: No, rely only on tool description.

Tradeoff:

- Upskill is useful because PowerPoint layout APIs require conventions and examples.
- Skipping it is simpler but may produce weaker generated presentations.

### Q6 - Storage And Download

Question: Should PPTX reuse the DOCX pattern: object storage + completed job row + download endpoint?

- 6A (recommended): Yes, mirror the DOCX generated-file contract.
- 6B: Return a direct file payload from the tool result.

Tradeoff:

- Mirroring DOCX gives a stable download URL and avoids large chat payloads.
- Direct payload is simpler only for small examples and does not scale well.

### Q7 - Route And Job Naming

Question: What names should backend artifacts use?

- 7A (recommended): job type `pptx_generate`, route `/pptx/jobs/:id/download`.
- 7B: generic job type `file_generate`, route `/generated-files/jobs/:id/download`.

Tradeoff:

- PPTX-specific backend names are a smaller local change.
- Generic names better match a future multi-format generated-file system but may broaden the branch.

### Q8 - Scope Limit

Question: How far should BR-21a go?

- 8A (recommended): Tool call + generation service + storage/download + chat file card support only.
- 8B: Also add reusable template support for PPTX.
- 8C: Also add PPTX parsing/import.

Tradeoff:

- 8A matches the requested slice.
- 8B and 8C are useful later but would make the branch much larger.

## Current Proposed Answer Block

The current proposal is:

```text
1A 2A 3A 4A 5A 6A 7A 8A
```

This block is not validated yet. The next step is user review and correction. After that, write the actual spec.
