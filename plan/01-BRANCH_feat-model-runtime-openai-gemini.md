# Feature: Model Runtime OpenAI + Gemini

## Objective
Deliver the provider abstraction layer and runtime routing with OpenAI and Gemini available for chat and structured flows, including BYOK precedence policies.

## Scope / Guardrails
- Scope limited to API provider runtime, credential policy, model catalog exposure, minimal UI model/provider selection wiring.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-model-runtime-openai-gemini` `API_PORT=8701` `UI_PORT=5101` `MAILDEV_UI_PORT=1001`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `plan/01-BRANCH_feat-model-runtime-openai-gemini.md`
  - `plan/DEBUG_TICKETS.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `spec/**`, `PLAN.md`, `TODO.md` (docs consolidation or roadmap sync only)
  - `scripts/**` (only if strictly required by the branch objective)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in this file before touching conditional/forbidden paths.
  - Include reason, impact, and rollback strategy.
  - Mirror exception in `plan/CONDUCTOR_QUESTIONS.md`.

## Questions / Notes
- MPA-Q1: Canonical naming/versioning policy for exposed model ids.
- MPA-Q2: Auto-link SSO identities by email or explicit confirmation.
- MPA-Q3: Admin workspace-level allow/deny policy for providers.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: This branch is scoped to one capability and remains independently mergeable.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot when UI/plugin surface is impacted).
- UAT checkpoints must be listed as checkboxes inside each relevant lot.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-<slug>`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-<slug>` after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read relevant `.mdc` files, `README.md`, `TODO.md`, and linked specs.
  - [ ] Confirm isolated worktree `tmp/feat-model-runtime-openai-gemini` and environment mapping (`ENV=feat-model-runtime-openai-gemini`).
  - [ ] Capture Make targets needed for debug/testing and CI parity.
  - [ ] Confirm scope and dependency boundaries with upstream branches.
  - [ ] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.
  - [ ] Finalize open questions required before implementation starts.

- [ ] **Lot 1 — Provider Contract + Registry**
  - [ ] Introduce provider runtime contract and registry in API services.
  - [ ] Refactor OpenAI integration behind provider adapter without behavior regression.
  - [ ] Add model catalog endpoint and persistence/memory strategy for defaults.
  - [ ] Lot 1 gate:
    - [ ] `make typecheck-api ENV=test-feat-model-runtime-openai-gemini`
    - [ ] `make lint-api ENV=test-feat-model-runtime-openai-gemini`
    - [ ] `make test-api ENV=test-feat-model-runtime-openai-gemini`
    - [ ] `make typecheck-ui ENV=test-feat-model-runtime-openai-gemini`
    - [ ] `make lint-ui ENV=test-feat-model-runtime-openai-gemini`
    - [ ] `make test-ui ENV=test-feat-model-runtime-openai-gemini`

- [ ] **Lot 2 — Gemini Adapter + Routing Policy**
  - [ ] Implement Gemini adapter with streaming + tool compatibility checks.
  - [ ] Implement credential precedence (request override, user BYOK, workspace key).
  - [ ] Expose provider/model selection in impacted UI flows (chat + structured options).
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-api ENV=test-feat-model-runtime-openai-gemini`
    - [ ] `make lint-api ENV=test-feat-model-runtime-openai-gemini`
    - [ ] `make test-api ENV=test-feat-model-runtime-openai-gemini`
    - [ ] `make typecheck-ui ENV=test-feat-model-runtime-openai-gemini`
    - [ ] `make lint-ui ENV=test-feat-model-runtime-openai-gemini`
    - [ ] `make test-ui ENV=test-feat-model-runtime-openai-gemini`

- [ ] **Lot N-2 — UAT**
  - [ ] Run targeted UAT scenarios for impacted capabilities.
  - [ ] Run non-regression checks on adjacent workflows.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Consolidate branch learnings into the relevant `spec/*` files.
  - [ ] Update `PLAN.md` status and dependency notes after integration readiness.

- [ ] **Lot N — Final validation**
  - [ ] Re-run full branch gates (typecheck, lint, tests, e2e when impacted).
  - [ ] Verify CI status and attach executed command list in PR notes.
  - [ ] Ensure branch remains orthogonal, mergeable, and non-blocking.
