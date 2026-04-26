# Feature: BR-21a — PptGenJS Presentation Tool

## Objective
Extend the existing `document_generate` chat tool with `format: "docx" | "pptx"`, backed by `pptxgenjs` for PPTX generation, with generated PPTX files handled in chat alongside generated DOCX files. The branch owns the generic generated-document tool behavior and generated-file chat handling. It does not own profile exports.

## Scope / Guardrails
- Branch in `tmp/feat-pptxgenjs-tool-21a`.
- Branch name `feat/pptxgenjs-tool-21a`.
- `ENV=feat-pptxgenjs-tool-21a` `API_PORT=8722` `UI_PORT=5122` `MAILDEV_UI_PORT=1022`.
- Depends on BR-04B freeform DOCX patterns for the chat tool and download card contract.
- A future profile branch may later consume this capability for profile PPTX exports.
- Q&A selected answer block: `1X 2B 3A 4A 5A 6A 7X 8A`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `plan/21a-BRAINSTORM_pptxgenjs-tool.md`, `api/src/services/*pptx*`, `api/src/routes/api/pptx.ts`, `api/src/services/tools.ts`, `api/src/services/chat-service.ts`, `ui/src/lib/components/StreamMessage.svelte`, `ui/src/lib/utils/pptx.ts`, `api/tests/**/*pptx*.test.ts`, `ui/tests/**/*pptx*.test.ts`, `spec/SPEC_EVOL_PPTXGENJS_TOOL.md`, `spec/TOOLS.md`, `spec/SPEC_TEMPLATING.md`
- **Forbidden Paths**: `README.md`, `README.fr.md`, `TRANSITION.md`, `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `spec/SPEC_EVOL_CV_TRANSPOSE_PROFILES.md`
- **Conditional Paths**: `api/package.json`, `api/package-lock.json`, `api/src/services/queue-manager.ts`, `.github/workflows/**`

## Feedback Loop
- [x] `clarification` BR21a-Q0 — Product principle accepted: PPTX generation is added to `document_generate` through `format: "docx" | "pptx"`, with generated PPTX files handled in chat alongside generated DOCX files.
- [x] `clarification` BR21a-Q1-Q8 — Selected answer block: `1X 2B 3A 4A 5A 6A 7X 8A`.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Restart from zero**
  - [x] Remove profile-export scope from BR-21a.
  - [x] Define generic PptGenJS tool questions.
  - [x] Replace premature spec with `plan/21a-BRAINSTORM_pptxgenjs-tool.md`.

- [x] **Lot 1 — Brainstorming and Q&A**
  - [x] Select Q1-Q8 answer block.
  - [x] Create `spec/SPEC_EVOL_PPTXGENJS_TOOL.md` from validated answers only.

- [ ] **Lot 2 — Contract**
  - [ ] Freeze tool name, action schema, job type, route, storage key, and UI card behavior.

- [ ] **Lot 3 — Generation engine**
  - [ ] Add `pptxgenjs` if required.
  - [ ] Implement sandbox helpers and skill/upskill content.
  - [ ] Implement freeform presentation generation.

- [ ] **Lot 4 — Chat/API integration**
  - [ ] Wire the selected chat tool.
  - [ ] Add download route and completed job persistence.
  - [ ] Add focused API tests.

- [ ] **Lot 5 — UI download card**
  - [ ] Generalize or extend the generated-file download card.
  - [ ] Keep DOCX behavior unchanged.

- [ ] **Lot 6 — Final validation**
  - [ ] Typecheck, lint, focused API/UI tests.
  - [ ] PR, CI, UAT if user-visible.
