# Feature: BR-21a PptGenJS Presentation Tool

## Objective
Extend the existing `document_generate` chat tool with `format: "docx" | "pptx"`, backed by `pptxgenjs` for PPTX generation, with generated PPTX files handled in chat alongside generated DOCX files. BR-21a owns only the generic generated-document primitive and generated-file chat handling. It does not implement profile exports, CV transpose, profile data models, proposal staffing, or profile-specific templates.

## Scope / Guardrails
- Scope limited to a generic PptGenJS-based presentation generation tool and its technical contract.
- Decision status: Q&A validated; implementation spec exists.
- Branch development happens in isolated worktree `tmp/feat-pptxgenjs-tool-21a`.
- Make-only workflow, no direct Docker commands.
- Automated tests must use dedicated environments, never root `dev`.
- Environment mapping: `API_PORT=8722 UI_PORT=5122 MAILDEV_UI_PORT=1022 ENV=feat-pptxgenjs-tool-21a`.
- Test mapping: `API_PORT=8722 UI_PORT=5122 MAILDEV_UI_PORT=1022 ENV=test-feat-pptxgenjs-tool-21a`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- A future profile branch may later consume this tool for profile exports, but BR-21a must stay profile-neutral.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `PLAN.md`
  - `plan/21a-BRAINSTORM_pptxgenjs-tool.md`
  - `plan/21a-BRANCH_feat-pptxgenjs-tool.md`
  - `spec/SPEC_EVOL_PPTXGENJS_TOOL.md`
  - `spec/SPEC_TEMPLATING.md`
  - `spec/TOOLS.md`
  - `api/src/services/docx-generation.ts`
  - `api/src/services/docx-freeform-helpers.ts`
  - `api/src/services/docx-freeform-skill.ts`
  - `api/src/services/pptx-generation.ts`
  - `api/src/services/pptx-freeform-helpers.ts`
  - `api/src/services/pptx-freeform-skill.ts`
  - `api/src/services/tools.ts`
  - `api/src/services/chat-service.ts`
  - `api/src/routes/api/docx.ts`
  - `api/src/routes/api/pptx.ts`
  - `api/src/routes/api/index.ts`
  - `api/tests/unit/*pptx*.test.ts`
  - `api/tests/unit/*docx*.test.ts`
  - `api/tests/api/*pptx*.test.ts`
  - `api/tests/api/*docx*.test.ts`
  - `ui/src/lib/utils/docx.ts`
  - `ui/src/lib/utils/pptx.ts`
  - `ui/src/lib/components/StreamMessage.svelte`
  - `ui/tests/*pptx*.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `README.md`
  - `README.fr.md`
  - `TRANSITION.md`
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/llm-mesh/**`
  - `spec/SPEC_EVOL_LLM_MESH.md`
  - `spec/SPEC_EVOL_CV_TRANSPOSE_PROFILES.md`
  - `tmp/feat-llm-mesh-sdk/**`
  - `tmp/feat-gdrive-sso-indexing-16a/**`
  - `tmp/feat-cv-transpose-profiles*/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `TODO.md`
  - `api/package.json`
  - `api/package-lock.json`
  - `api/src/db/schema.ts`
  - `api/drizzle/*.sql`
  - `api/src/services/queue-manager.ts`
  - `ui/**`
  - `e2e/**`
  - `scripts/**`
- **Exception process**:
  - Declare exception ID `BR21a-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `clarification` BR21a-Q0 — Product principle accepted: one additional chat tool call for PPTX generation, with generated PPTX files handled in chat alongside generated DOCX files.
- [x] `clarification` BR21a-Q1-Q8 — Q&A selected: `1X 2B 3A 4A 5A 6A 7X 8A`. Keep `document_generate`, add `format: "docx" | "pptx"`, mutualize generated-file UI/download behavior, sandbox PptGenJS with exposed helpers, use an upskill action adapted from Anthropic `pptx` skill guidance.
- [ ] `attention` BR21a-EX1 — `api/package.json` and `api/package-lock.json` are conditionally allowed if `pptxgenjs` is not already installed. Reason: renderer dependency. Impact: dependency metadata only. Rollback: remove dependency and renderer import.
- [ ] `attention` BR21a-EX2 — `api/src/services/queue-manager.ts` is conditionally allowed only if BR21a-Q2 selects a queued generation path. Reason: job processing integration. Impact: queue plumbing only. Rollback: keep synchronous freeform-only generation.
- [ ] `attention` BR21a-EX3 — broader `ui/**` edits are conditionally allowed only if the download card cannot be generalized inside `StreamMessage.svelte` and `ui/src/lib/utils/pptx.ts`. Reason: UI download affordance. Impact: presentation of generated files only. Rollback: revert to text-only tool result.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and restart**
  - [x] Read `rules/MASTER.md` and `rules/workflow.md`.
  - [x] Rename branch/worktree to `feat/pptxgenjs-tool-21a` / `tmp/feat-pptxgenjs-tool-21a`.
  - [x] Remove the previous profile-export scope from BR-21a.
  - [x] Define environment and test mappings.
  - [x] Locate the existing freeform DOCX tool and storage/download contract.
  - [x] Replace premature spec with `plan/21a-BRAINSTORM_pptxgenjs-tool.md`.
  - [x] Finalize BR21a-Q1-Q8 before writing the spec.

- [x] **Lot 1 — Brainstorming and Q&A**
  - [x] Validate or edit answer block in `plan/21a-BRAINSTORM_pptxgenjs-tool.md`.
  - [x] Record the selected answer block in this file.
  - [x] Create `spec/SPEC_EVOL_PPTXGENJS_TOOL.md` only after Q&A is validated.

- [x] **Lot 2 — Presentation tool specification**
  - [x] Freeze the selected tool name, route name, job type, and UI download contract.
  - [x] Define the freeform PptGenJS helper API.
  - [x] Define the sandbox allowlist, error codes, and return type contract.
  - [x] Define expected `upskill` content and generation prompt boundaries.

- [ ] **Lot 3 — PptGenJS generation engine**
  - [ ] Add `pptxgenjs` dependency through BR21a-EX1 if required.
  - [ ] Implement `api/src/services/pptx-freeform-helpers.ts`.
  - [ ] Implement `api/src/services/pptx-freeform-skill.ts`.
  - [ ] Implement `api/src/services/pptx-generation.ts`.
  - [ ] Gate: typecheck/lint/API unit tests.

- [ ] **Lot 4 — API and chat tool integration**
  - [ ] Add the chat tool surface selected in BR21a-Q1.
  - [ ] Add generation handling in `chat-service.ts`.
  - [ ] Persist format-aware generated-file metadata compatible with DOCX and PPTX downloads.
  - [ ] Add or adapt shared generated-file download routing while preserving existing DOCX downloads.
  - [ ] Gate: typecheck/lint/API endpoint tests.

- [ ] **Lot 5 — UI download affordance**
  - [ ] Reuse or generalize the current DOCX download card path according to BR21a-Q7.
  - [ ] Add `.pptx` download helper if needed.
  - [ ] Gate: UI typecheck/lint and focused UI tests where feasible.

- [ ] **Lot 6 — Docs consolidation**
  - [ ] Update `spec/TOOLS.md` with the final tool contract.
  - [ ] Update `spec/SPEC_TEMPLATING.md` only for generic presentation generation behavior.
  - [ ] Keep profile-specific PPTX export out of BR-21a docs.
  - [ ] Update `BRANCH.md` feedback loop with final decisions.

- [ ] **Lot 7 — Final validation**
  - [ ] `make typecheck-api API_PORT=8722 UI_PORT=5122 MAILDEV_UI_PORT=1022 ENV=test-feat-pptxgenjs-tool-21a`
  - [ ] `make lint-api API_PORT=8722 UI_PORT=5122 MAILDEV_UI_PORT=1022 ENV=test-feat-pptxgenjs-tool-21a`
  - [ ] Focused API/unit tests for freeform PPTX generation.
  - [ ] UI tests if the download card path changes.
  - [ ] PR, CI, UAT if there is a user-visible chat generation path.
  - [ ] Remove `BRANCH.md` before merge once CI + UAT are both OK.
