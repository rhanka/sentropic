# Feature: T3 prod A4 cutover IaC (pins + prod-a4 switch)

## Objective
- IaC for T3 fence: pin candidate images in `overlays/prod`, switch `make k8s-deploy` to `overlays/prod-a4`.

## Scope / Guardrails
- Scope limited to prod overlay pins + `k8s-deploy` overlay path.
- No migration in `api/drizzle/*.sql`.
- Make-only workflow, no direct Docker commands.
- Branch work in worktree `tmp/t3-prod-a4-iac`.
- `ENV=<env>` always last in `make` commands; never `ENV=dev`; never `make clean-all`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/k8s/overlays/prod/kustomization.yaml`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (`k8s-deploy` target only, under T3-EX1)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- [x] T3-EX1 (`Makefile`, `k8s-deploy` target only): reason = runbook `prod-a4-cutover.md` After-1 requires `make k8s-deploy` to apply `overlays/prod-a4` after the fence (otherwise next prod apply removes A4 wiring); impact = prod deploy path only, single `apply -k` line, preprod target untouched; rollback = revert commit or re-apply `origin/main` overlay path.
- [ ] `blocked` / `deferred` / `cancelled` / `attention`: none open.
- [ ] `clarification` / `acknowledge` / `refuse`: owner GO 10/11 ~20:40 Montreal covers T3 fence; merge by conductor at step I (never by operator).

## AI Flaky tests
- [ ] Acceptance rule applies as written; no AI tests in scope (no code change).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single IaC change, one CI cycle on the draft PR).
- [ ] **Multi-branch** (not needed: no sub-workstreams).
- Rationale: two-file IaC change, one draft PR, CI green, merge by conductor at fence step I.

## UAT Management (in orchestration context)
- [x] **Mono-branch**: no UAT (no user-facing change; images verified by T2 rehearsal receipt).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Worktree `tmp/t3-prod-a4-iac` from `origin/main`, branch `feat/t3-prod-a4-iac`.
  - [x] Candidate PIN: api=IdP `405a2759...` (commit `4625a94b...`), ui `18ad65c8...` (T2 verdict T2-GO).
  - [x] Scope boundaries validated; T3-EX1 declared before touching `Makefile`.
- [x] **Lot 1 — IaC change**
  - [x] Pin candidate api/auth-idp/artifact-content/ui digests in `overlays/prod`.
  - [x] Switch `make k8s-deploy` apply path to `overlays/prod-a4`.
  - [ ] Lot gate: `make scope-check` before commit; commit via `make commit`; push; draft PR; CI green.
- [ ] **Lot N — Final validation**
  - [ ] CI green on draft PR.
  - [ ] `BRANCH.md` deleted (final commit), push; PR left open for conductor merge at step I.
