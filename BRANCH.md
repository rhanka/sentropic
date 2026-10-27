# Feature: ci(idp): materialize the preprod workload Secret from the protected GitHub secret

## Objective
- [x] Deliver the protected manual workflow for materializing `sentropic-preprod/immo-mcp-workload` before named-Secret identity sync; execution stays owner-operated.

## Scope / Guardrails
- [x] Scope limited to the workload Secret workflow, its selftests, CI path filter and credential-cycle documentation.
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
- [x] BR800-EX2 / acknowledge: owner authorizes `.github/workflows/ci.yml`. Rationale: workflow-only PRs must run the workload Secret guard selftest. Impact: add only the workload workflow to the existing `idp_sync` path filter. Rollback: remove that filter entry.
- [x] IDP-EX1 / acknowledge: owner explicitly authorizes `.github/workflows/idp-workload-secret.yml`. Rationale: the cluster is reachable only through protected CI. Impact: a main-only manual job can create/update only the intended workload Secret in this workflow; it uses the existing delegated preprod identity. Rollback: remove the workflow; restore prior credential through the same governed channel and named-Secret sync if material was changed.
- [x] No-Docker gate: `test-idp-sync-selftest` starts containers; defer runtime selftests to existing CI `validate-idp-sync`.
- [x] Conductor clarification: reuse `configure preprod` unchanged; no preprod apiserver-host assertion in this lot.
- [x] The workload credential already exists in GitHub environment `sentropic-idp-run`; consume its environment secret, not a repository secret.
- [x] Review / attention: author inspection completed; independent consensus selection unavailable because no live model catalog is configured. Evidence: ignored root `.tmp/idp-workload-secret-review.md`, target `dae48f8966a6ff4cb430f9ad387688188c509932`; no peer consensus claimed.

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
- [x] **Lot 1 — Protected materialization**
  - [x] Add `.github/workflows/idp-workload-secret.yml`: dispatch only, selftest-gated main-only materialization job, Node 24, matching kubectl pin, existing configure and always-cleanup actions.
  - [x] Validate exactly 64 lowercase hex without newline; apply a 0600 temporary Opaque manifest without leaking values or kubectl diagnostics.
  - [x] Emit only name, namespace, configured status and an eight-hex SHA-256 fingerprint.
  - [x] Lot gate: mechanical host harness scope check through `make scope-check ENV=test-861-int`; this existing host-only target avoids Docker.
- [x] **Lot 2 — Selftests and documentation**
  - [x] Extend `deploy/ci/idp-identity-sync/workflow.selftest.mjs` for dispatch-only wiring, protected environment, no secret echo and always cleanup.
  - [x] Add CI execution of real Node materialization with synthetic fixtures and stubbed kubectl; reject malformed credentials without invoking kubectl.
  - [x] Update `deploy/ci/idp-identity-sync/CRED_CYCLE.md`: `.env` → `sentropic-idp-run` environment secret → protected workflow → named-Secret sync.
  - [x] Lot gate: runtime selftests delegated to CI `make test-idp-sync-selftest ENV=test-idp-sync` because the existing target starts containers.
- [x] **Lot 3 — Opus r1 corrections**
  - [x] P2-1: use server-side apply with field manager `idp-workload-secret`; assert kubectl arguments exclude client-side Secret apply.
  - [x] P2-2: add the workload workflow to CI `idp_sync`; require its selftest job before materialization and assert both gates.
- [ ] **Lot N — Final validation**
  - [x] Review every hunk and record independent-review availability above.
  - [x] Validate scope before each `make commit`; selectively stage, no AI trailers.
  - [x] Push branch and create PR #800 to `main` with this plan as body and the owner title.
  - [ ] Wait for CI and report exact head SHA; no merge or dispatch.
