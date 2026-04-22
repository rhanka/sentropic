# Feature: BR-21a PptGenJS Presentation Tool

## Objective
Create a generic PowerPoint generation tool backed by `pptxgenjs`, analogous to the existing freeform DOCX `document_generate` tool. BR-21a owns the reusable presentation generation primitive only: sandboxed generation, skill/upskill guidance, storage/download contract, chat tool wiring, and focused tests. It does not implement profile exports, CV transpose, profile data models, proposal staffing, or profile-specific templates.

## Scope / Guardrails
- Scope limited to a generic PptGenJS-based presentation generation tool and its technical contract.
- Decision status: Q1-Q8 below are proposals only. Do not start implementation until the user validates or edits the answer block.
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
  - `plan/21a-BRANCH_feat-pptxgenjs-tool.md`
  - `spec/SPEC_EVOL_PPTXGENJS_TOOL.md`
  - `spec/SPEC_TEMPLATING.md`
  - `spec/TOOLS.md`
  - `api/src/services/pptx-generation.ts`
  - `api/src/services/pptx-freeform-helpers.ts`
  - `api/src/services/pptx-freeform-skill.ts`
  - `api/src/services/tools.ts`
  - `api/src/services/chat-service.ts`
  - `api/src/routes/api/pptx.ts`
  - `api/src/routes/api/index.ts`
  - `api/tests/unit/*pptx*.test.ts`
  - `api/tests/api/*pptx*.test.ts`
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
- [ ] `attention` BR21a-Q0 — User validation required before implementation. The Q1-Q8 answer block is not selected yet; it is a proposal to review, not an approved spec.
- [ ] `attention` BR21a-Q1 — Tool surface.
  - 1A (recommended): Add a dedicated `presentation_generate` chat tool, parallel to `document_generate`.
  - 1B: Extend `document_generate` with `format: "pptx"`.
  - 1C: Backend route only, no chat tool in BR-21a.
- [ ] `attention` BR21a-Q2 — Execution model.
  - 2A (recommended): Synchronous freeform generation in the chat handler, matching freeform DOCX behavior.
  - 2B: Queue all PPTX generation through `job_queue`.
  - 2C: Synchronous for freeform, queued for future template/batch modes.
- [ ] `attention` BR21a-Q3 — Output and download contract.
  - 3A (recommended): Upload generated PPTX to S3-compatible storage, persist a completed `pptx_generate` job, and render an inline download card.
  - 3B: Return a raw base64 PPTX payload in the tool result.
  - 3C: Stream the generated file directly from the chat response path.
- [ ] `attention` BR21a-Q4 — Upskill pattern.
  - 4A (recommended): Require `presentation_generate({ action: "upskill" })` before first generation in a conversation.
  - 4B: No upskill action; embed all instructions in the tool description.
  - 4C: Use only external documentation links.
- [ ] `attention` BR21a-Q5 — Data/context contract.
  - 5A (recommended): Reuse the freeform DOCX context model: `entityType`, `entityId`, workspace-scoped data, and explicit user-provided content.
  - 5B: No application context; only code-provided static data.
  - 5C: Profile-specific context. Rejected for BR-21a because profiles do not exist yet.
- [ ] `attention` BR21a-Q6 — Sandbox contract.
  - 6A (recommended): Node VM sandbox with whitelisted PptGenJS exports and small helpers.
  - 6B: Prompt-to-JSON slide DSL first, then renderer interprets the DSL.
  - 6C: Unrestricted JavaScript execution. Rejected.
- [ ] `attention` BR21a-Q7 — UI rendering.
  - 7A (recommended): Generalize the current DOCX download card path into a file/download card that supports `.docx` and `.pptx`.
  - 7B: Add a PPTX-specific card beside the DOCX card.
  - 7C: No UI card; return only a textual download URL.
- [ ] `attention` BR21a-Q8 — Public naming.
  - 8A (recommended): Tool name `presentation_generate`, job type `pptx_generate`, route `/pptx/jobs/:id/download`.
  - 8B: Tool name `pptx_generate`.
  - 8C: Tool name `slide_generate`.
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
  - [x] Create `spec/SPEC_EVOL_PPTXGENJS_TOOL.md` as the launch brainstorming/spec file.
  - [x] Mark Q1-Q8 as unvalidated proposals after user review concern.
  - [ ] Finalize BR21a-Q1 to BR21a-Q8 before implementation.

- [ ] **Lot 1 — Presentation tool specification**
  - [ ] Freeze the selected tool name, route name, job type, and UI download contract.
  - [ ] Define the freeform PptGenJS helper API.
  - [ ] Define the sandbox allowlist, error codes, and return type contract.
  - [ ] Define expected `upskill` content and generation prompt boundaries.

- [ ] **Lot 2 — PptGenJS generation engine**
  - [ ] Add `pptxgenjs` dependency through BR21a-EX1 if required.
  - [ ] Implement `api/src/services/pptx-freeform-helpers.ts`.
  - [ ] Implement `api/src/services/pptx-freeform-skill.ts`.
  - [ ] Implement `api/src/services/pptx-generation.ts`.
  - [ ] Gate: typecheck/lint/API unit tests.

- [ ] **Lot 3 — API and chat tool integration**
  - [ ] Add the chat tool surface selected in BR21a-Q1.
  - [ ] Add generation handling in `chat-service.ts`.
  - [ ] Persist completed `pptx_generate` metadata compatible with download.
  - [ ] Add `GET /pptx/jobs/:id/download`.
  - [ ] Gate: typecheck/lint/API endpoint tests.

- [ ] **Lot 4 — UI download affordance**
  - [ ] Reuse or generalize the current DOCX download card path according to BR21a-Q7.
  - [ ] Add `.pptx` download helper if needed.
  - [ ] Gate: UI typecheck/lint and focused UI tests where feasible.

- [ ] **Lot 5 — Docs consolidation**
  - [ ] Update `spec/TOOLS.md` with the final tool contract.
  - [ ] Update `spec/SPEC_TEMPLATING.md` only for generic presentation generation behavior.
  - [ ] Keep profile-specific PPTX export out of BR-21a docs.
  - [ ] Update `BRANCH.md` feedback loop with final decisions.

- [ ] **Lot 6 — Final validation**
  - [ ] `make typecheck-api API_PORT=8722 UI_PORT=5122 MAILDEV_UI_PORT=1022 ENV=test-feat-pptxgenjs-tool-21a`
  - [ ] `make lint-api API_PORT=8722 UI_PORT=5122 MAILDEV_UI_PORT=1022 ENV=test-feat-pptxgenjs-tool-21a`
  - [ ] Focused API/unit tests for freeform PPTX generation.
  - [ ] UI tests if the download card path changes.
  - [ ] PR, CI, UAT if there is a user-visible chat generation path.
  - [ ] Remove `BRANCH.md` before merge once CI + UAT are both OK.
