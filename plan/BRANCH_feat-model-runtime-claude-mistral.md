# Feature: Model Runtime Claude + Mistral

## Objective
Extend provider runtime to Anthropic Claude and Mistral while preserving compatibility of streaming/tool orchestration.

## Scope / Guardrails
- Scope limited to Provider adapters, model catalog expansion, routing/fallback policy.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-model-runtime-claude-mistral` `API_PORT=8708` `UI_PORT=5108` `MAILDEV_UI_PORT=1008`.

## Questions / Notes
- MPA-Q4: Provider request/response retention compliance baseline.
- MPA-Q5: Fallback behavior in same request vs user-driven retry.
- Define parity criteria for tool support between providers.

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
  - [ ] Confirm isolated worktree `tmp/feat-model-runtime-claude-mistral` and environment mapping (`ENV=feat-model-runtime-claude-mistral`).
  - [ ] Capture Make targets needed for debug/testing and CI parity.
  - [ ] Confirm scope and dependency boundaries with upstream branches.
  - [ ] Finalize open questions required before implementation starts.

- [ ] **Lot 1 — Provider Adapter Expansion**
  - [ ] Implement Claude and Mistral provider adapters with shared contract.
  - [ ] Expand model catalog and default selection rules.
  - [ ] Normalize provider-specific error handling.
  - [ ] Lot 1 gate:
    - [ ] `make typecheck-api ENV=test-feat-model-runtime-claude-mistral`
    - [ ] `make lint-api ENV=test-feat-model-runtime-claude-mistral`
    - [ ] `make test-api ENV=test-feat-model-runtime-claude-mistral`
    - [ ] `make typecheck-ui ENV=test-feat-model-runtime-claude-mistral`
    - [ ] `make lint-ui ENV=test-feat-model-runtime-claude-mistral`
    - [ ] `make test-ui ENV=test-feat-model-runtime-claude-mistral`

- [ ] **Lot 2 — Routing Hardening + Regression**
  - [ ] Add provider routing constraints and capability-aware selection.
  - [ ] Validate chat and structured flows across four providers.
  - [ ] Add full non-regression test coverage for multi-provider runtime.
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-api ENV=test-feat-model-runtime-claude-mistral`
    - [ ] `make lint-api ENV=test-feat-model-runtime-claude-mistral`
    - [ ] `make test-api ENV=test-feat-model-runtime-claude-mistral`
    - [ ] `make typecheck-ui ENV=test-feat-model-runtime-claude-mistral`
    - [ ] `make lint-ui ENV=test-feat-model-runtime-claude-mistral`
    - [ ] `make test-ui ENV=test-feat-model-runtime-claude-mistral`

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
