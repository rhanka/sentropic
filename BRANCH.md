# Feature: ci(idp): materialize the preprod workload Secret from the protected GitHub secret

## Objective
- [ ] Materialize `sentropic-preprod/immo-mcp-workload` through a protected manual workflow before named-Secret identity sync.

## Scope / Guardrails
- [x] Scope limited to the workload Secret workflow, its selftests and credential-cycle documentation.
- [x] Make-only workflow; no Docker, Python, dispatch or merge.
- [x] Root workspace `~/src/sentropic` remains reserved for user dev (`ENV=dev`).
- [x] Branch development happens in `tmp/worktrees/idp-workload-secret` on `feat/idp-workload-secret-workflow` from `origin/main`.
- [x] Automated tests use `ENV=test-idp-workload-secret`; no services or ports are allocated.
- [x] In every `make` command, `ENV=<env>` must be passed as the last argument.
- [x] All new text in English; credentials never enter committed files or logs.
- [x] The ignored central 0600 `.env` line is the credential source of truth.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.github/workflows/idp-workload-secret.yml`
  - `deploy/ci/idp-identity-sync/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare exceptions before editing, with rationale, impact and rollback in `## Feedback Loop`.

## Feedback Loop
- [x] IDP-EX1 / acknowledge: owner explicitly authorizes `.github/workflows/idp-workload-secret.yml`. Rationale: the cluster is reachable only through protected CI. Impact: a main-only manual job can create/update only the intended workload Secret in this workflow; it uses the existing delegated preprod identity. Rollback: remove the workflow; restore prior credential through the same governed channel and named-Secret sync if material was changed.
- [x] No-Docker gate: `test-idp-sync-selftest` starts containers; defer runtime selftests to existing CI `validate-idp-sync`.
- [ ] Confirm the requested apiserver assertion: existing `configure preprod` has no host assertion; only prod currently checks its expected host.

## AI Flaky tests
- [x] No AI-dependent tests; do not accept failed deterministic checks as flaky.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: one capability, atomic commits under 150 changed lines.
- [ ] **Multi-branch** (not required).

## UAT Management (in orchestration context)
- [x] Web app, Chrome and VSCode UAT are not applicable to this CI-only workflow.
- [x] Live Secret materialization is intentionally left undispatched by owner instruction.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read rules, template, existing workflow, runner, selftests and credential cycle.
  - [x] Create isolated worktree and pass mechanical `harness check branch`.
  - [x] Confirm `sentropic-idp-run` permits only `main` and inspect existing make targets.
- [ ] **Lot 1 — Protected materialization**
  - [ ] Add `.github/workflows/idp-workload-secret.yml`: dispatch only, single main-only job, Node 24, matching kubectl pin, existing configure and always-cleanup actions.
  - [ ] Validate exactly 64 lowercase hex without newline; apply a 0600 temporary Opaque manifest without leaking values or kubectl diagnostics.
  - [ ] Emit only name, namespace, created/configured and an eight-hex SHA-256 fingerprint.
  - [ ] Lot gate: mechanical host harness scope check through make; no containers.
- [ ] **Lot 2 — Selftests and documentation**
  - [ ] Extend `deploy/ci/idp-identity-sync/workflow.selftest.mjs` for dispatch-only wiring, protected environment, no secret echo and always cleanup.
  - [ ] Exercise real Node materialization with synthetic fixtures and stubbed kubectl in CI; reject malformed credentials without invoking kubectl.
  - [ ] Update `deploy/ci/idp-identity-sync/CRED_CYCLE.md`: `.env` → repository secret → protected workflow → named-Secret sync.
  - [ ] Lot gate: run existing `make test-idp-sync-selftest ENV=test-idp-sync` only in CI because it starts containers.
- [ ] **Lot N — Final validation**
  - [ ] Review every hunk and reconcile independent review where available.
  - [ ] Validate scope before each `make commit`; selectively stage, no AI trailers.
  - [ ] Push branch and create PR to `main` with this plan as body and the owner title.
  - [ ] Wait for CI and report exact head SHA; no merge or dispatch.
