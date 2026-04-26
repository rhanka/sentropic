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
- [x] `clarification` BR21a-Q9 — Anthropic `pptx` skill references are generation-only inspiration for BR-21a. Editing workflows, Python helper libraries, local filesystem workflows, and template import/repair flows are out of scope. Entropic must use the existing DOCX-style JavaScript VM sandbox pattern with approved PptGenJS helpers, not Claude's sandbox assumptions.
- [x] `attention` BR21a-EX1 — Used for `api/package.json` and `api/package-lock.json` because `pptxgenjs` is not already installed. Reason: renderer dependency. Impact: dependency metadata only. Rollback: remove dependency and renderer import.
- [ ] `attention` BR21a-EX2 — `api/src/services/queue-manager.ts` is conditionally allowed only if BR21a-Q2 selects a queued generation path. Reason: job processing integration. Impact: queue plumbing only. Rollback: keep synchronous freeform-only generation.
- [x] `acknowledge` BR21a-EX3 — Approved and used for `ui/src/lib/components/ChatPanel.svelte` plus aligned UI tests under `ui/**` because the visible generated-file card lives in `ChatPanel.svelte` (`docxCardsByMessageId`, hard-coded `DOCX` label, and `downloadCompletedDocxJob(...)` button), while `StreamMessage.svelte` only forwards tool results. Reason: PPTX label + route selection cannot be generalized correctly inside the original allowed files alone. Impact: presentation of generated files only. Rollback: revert the generalized chat card/download changes and keep the existing DOCX-only card path.
- [x] `decision` BR21a-D1 — Final generated-file contract stays tool-neutral: `document_generate` returns generic generated-file metadata, chat runtime prefers `generatedFileCards`, and `runtimeSummary.docxCards` remains a DOCX-only backward-compatible alias during migration. Profile/CV export behavior stays out of scope for BR-21a.
- [x] `deferred` BR21a-D2 — GitHub Actions Node 24 compatibility is outside BR-21a scope and is queued as future branch BR-24 `chore/node24-actions-upgrade` because current CI/CD only emits runner deprecation warnings and does not block the PPTX delivery path.
- [x] `attention` BR21a-UAT1 — Root UAT reproduced two blocking runtime issues on PPTX generation: repeated `code_runtime_error: pptxgenjs is not a constructor` failures and one retry without `entityId`. Fix on this branch: resolve a constructible PptGenJS export before exposing it to the sandbox, stop relying on constructor identity in PPTX result validation, prefer `pptx()` in PPTX guidance/prompting, and fall back `document_generate` to the active folder/initiative chat context when the model omits the current target. Impact: API-only hardening inside BR-21a scope. Rollback: revert the PPTX constructor resolver, presentation-shape validation, and document target fallback changes.
- [x] `validation` BR21a-UAT2 — Root UAT rerun on 2026-04-25 from `http://localhost:5173/folders/623d703d-8d4f-4b19-a0bf-fef53d317f08` completed successfully after `b58763cf`: retry stream `ada485e5-bc11-4dc4-a399-bc8c6d217062` finished with `document_generate` result status `completed`, job `4f77a5db-f6ad-4220-8cd2-7df4fa75688b`, file `Presentation cas dusage Ellio.pptx`, and the chat UI rendered the PPTX card plus download link. No dedicated BR21a E2E test exists; branch proof is focused API/UI tests plus root UAT.

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

- [x] **Lot 3 — PptGenJS generation engine**
  - [x] Add `pptxgenjs` dependency through BR21a-EX1 if required.
  - [x] Implement `api/src/services/pptx-freeform-helpers.ts`.
  - [x] Implement `api/src/services/pptx-freeform-skill.ts`.
  - [x] Implement `api/src/services/pptx-generation.ts`.
  - [x] Gate: typecheck/lint/API unit tests.

- [x] **Lot 4 — API and chat tool integration**
  - [x] Add the chat tool surface selected in BR21a-Q1.
  - [x] Add generation handling in `chat-service.ts`.
  - [x] Persist format-aware generated-file metadata compatible with DOCX and PPTX downloads.
  - [x] Add or adapt shared generated-file download routing while preserving existing DOCX downloads.
  - [x] Gate: typecheck/lint/API endpoint tests.

- [x] **Lot 5 — UI download affordance**
  - [x] Reuse or generalize the current DOCX download card path according to BR21a-Q7.
  - [x] Add `.pptx` download helper if needed.
  - [x] Gate: UI typecheck/lint and focused UI tests where feasible.

- [x] **Lot 6 — Docs consolidation**
  - [x] Update `spec/TOOLS.md` with the final tool contract.
  - [x] Update `spec/SPEC_TEMPLATING.md` only for generic presentation generation behavior.
  - [x] Keep profile-specific PPTX export out of BR-21a docs.
  - [x] Update `BRANCH.md` feedback loop with final decisions.

- [ ] **Lot 7 — Final validation**
  - [x] `make typecheck-api API_PORT=8722 UI_PORT=5122 MAILDEV_UI_PORT=1022 ENV=test-feat-pptxgenjs-tool-21a`
  - [x] `make lint-api API_PORT=8722 UI_PORT=5122 MAILDEV_UI_PORT=1022 ENV=test-feat-pptxgenjs-tool-21a`
  - [x] Focused API/unit tests for freeform PPTX generation.
  - [x] UI tests if the download card path changes.
  - [x] Root UAT on the user-visible chat generation path.
  - [x] Create/update PR.
  - [ ] Verify branch CI.
  - [ ] Remove `BRANCH.md` before merge once CI + UAT are both OK.
