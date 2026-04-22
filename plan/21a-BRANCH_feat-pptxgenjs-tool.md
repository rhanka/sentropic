# Feature: BR-21a — PptGenJS Presentation Tool

## Objective
Create a reusable PowerPoint generation primitive backed by `pptxgenjs`, equivalent in spirit to the existing freeform DOCX `document_generate` capability. The branch owns the generic presentation tool, sandbox, storage/download contract, and chat/UI integration. It does not own profile exports.

## Scope / Guardrails
- Branch in `tmp/feat-pptxgenjs-tool-21a`.
- Branch name `feat/pptxgenjs-tool-21a`.
- `ENV=feat-pptxgenjs-tool-21a` `API_PORT=8722` `UI_PORT=5122` `MAILDEV_UI_PORT=1022`.
- Depends on BR-04B freeform DOCX patterns for the chat tool and download card contract.
- A future profile branch may later consume this capability for profile PPTX exports.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `api/src/services/*pptx*`, `api/src/routes/api/pptx.ts`, `api/src/services/tools.ts`, `api/src/services/chat-service.ts`, `ui/src/lib/components/StreamMessage.svelte`, `ui/src/lib/utils/pptx.ts`, `api/tests/**/*pptx*.test.ts`, `ui/tests/**/*pptx*.test.ts`, `spec/SPEC_EVOL_PPTXGENJS_TOOL.md`, `spec/TOOLS.md`, `spec/SPEC_TEMPLATING.md`
- **Forbidden Paths**: `README.md`, `README.fr.md`, `TRANSITION.md`, `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `spec/SPEC_EVOL_CV_TRANSPOSE_PROFILES.md`
- **Conditional Paths**: `api/package.json`, `api/package-lock.json`, `api/src/services/queue-manager.ts`, `.github/workflows/**`

## Feedback Loop
- [ ] `attention` BR21a-Q1 to BR21a-Q8 are tracked in `tmp/feat-pptxgenjs-tool-21a/BRANCH.md` and `spec/SPEC_EVOL_PPTXGENJS_TOOL.md`.
- [ ] `attention` BR21a-Q0 — Q1-Q8 are proposals only and require user validation before implementation.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Restart from zero**
  - [x] Remove profile-export scope from BR-21a.
  - [x] Define generic PptGenJS tool questions.
  - [x] Create `spec/SPEC_EVOL_PPTXGENJS_TOOL.md`.
  - [x] Mark the spec as not user-validated.

- [ ] **Lot 1 — Contract**
  - [ ] Select Q1-Q8 answer block.
  - [ ] Freeze tool name, action schema, job type, route, storage key, and UI card behavior.

- [ ] **Lot 2 — Generation engine**
  - [ ] Add `pptxgenjs` if required.
  - [ ] Implement sandbox helpers and skill/upskill content.
  - [ ] Implement freeform presentation generation.

- [ ] **Lot 3 — Chat/API integration**
  - [ ] Wire the selected chat tool.
  - [ ] Add download route and completed job persistence.
  - [ ] Add focused API tests.

- [ ] **Lot 4 — UI download card**
  - [ ] Generalize or extend the generated-file download card.
  - [ ] Keep DOCX behavior unchanged.

- [ ] **Lot 5 — Final validation**
  - [ ] Typecheck, lint, focused API/UI tests.
  - [ ] PR, CI, UAT if user-visible.
