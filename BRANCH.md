# Feature: CI evols — split API build/tests and evaluate matrix for API test suites

## Objective
Decouple API image build from API unit/integration tests so E2E can start earlier, and ensure API publication is gated by API unit/integration validation.

## Scope / Guardrails
- Scope limited to CI workflow changes in `.github/workflows/ci.yml`.
- No application/runtime code changes.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-ci-evols-api-pipeline` (follow-up step if not already isolated).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Questions / Notes
- API test matrix is implemented per API suite (`smoke`, `unit`, `endpoints`, `queue`, `ai`, `security`, `limit`) to parallelize and keep publish gating explicit.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single CI workflow concern, orthogonal and self-contained.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI behavioral changes in this branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read relevant `.mdc` files and templates.
  - [x] Inspect current CI dependency graph and identify coupling points.
  - [x] Define minimal change scope.

- [x] **Lot 1 — CI dependency refactor**
  - [x] Split API image build from API unit/integration tests.
  - [x] Update E2E/security/smoke dependencies to use API build-only job.
  - [x] Gate API publish on API unit/integration test job.

- [x] **Lot 2 — Matrix evaluation and implementation**
  - [x] Evaluate matrix for API unit/integration suites.
  - [x] Implement CI matrix strategy for API suites.

- [x] **Lot N — Final validation**
  - [x] Validate workflow syntax and structural consistency.
  - [x] Review final diff and document behavior changes.
