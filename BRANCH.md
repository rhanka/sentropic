# Feature: Preprod A4 cutover release (sentropic-a4-20261108)

## Objective
- [x] Make continuous deployment keep the A4 runtime that the fenced cutover of 2026-11-08 installed on sentropic-preprod: pin the candidate API (main ad3be44e7) and UI (main fa4a1e4fb) digests, apply `overlays/preprod-a4`, and ship the launcher that runs through its ConfigMap symlink (PR #949, folded in here).

## Scope / Guardrails
- [x] Branch deploy/preprod-a4-cutover on fix/a4-runtime-launcher-symlink (e1bd0f9ff, from main ad3be44e7); worktree tmp/worktrees/a4-iac; ENV=test-a4-iac.
- [x] Make only; no Python, no attribution trailers, no CI skips or reruns.
- [x] Prod untouched: `overlays/prod` and base unchanged.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/k8s/overlays/preprod/kustomization.yaml`
  - `deploy/k8s/overlays/preprod-a4/kustomization.yaml`
  - `deploy/k8s/overlays/preprod/a4-runtime/launch.mjs`
  - `deploy/ci/preprod-a4/bundle.selftest.mjs`
  - `deploy/ci/preprod-a4/launch-symlink.test.mjs`
  - `docs/runbooks/preprod-a4-cutover.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `api/**`
  - `packages/**`
  - `deploy/k8s/overlays/prod/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**` (BRA4L-EX1: `ci.yml` api filter only)
  - `Makefile` (BRA4C-EX1: `k8s-deploy-preprod` apply path only)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] `attention` BRA4L-EX1: `consumer-contracts` classifies `deploy/k8s/**/*.mjs` as runtime-security and requires the API/UI/e2e consumers; add `deploy/k8s/overlays/preprod/a4-runtime/**` to the `ci.yml` `api` filter (no in-block comment: `check-ci-version-filters.sh` ends a block at a comment). Rollback: remove the filter line.
- [x] `attention` BRA4C-EX1: `k8s-deploy-preprod` applies `overlays/preprod-a4` instead of `overlays/preprod`; the image pin step still targets `overlays/preprod/kustomization.yaml`, which preprod-a4 inherits. Rollback: restore the recovery pin and the previous apply path, then the B0/F1 whole-database restore of the runbook.
- [x] `attention`: without the launcher fix the A4 API/IdP exit 0 under their ConfigMap symlink (CrashLoopBackOff); found in sentropic-restore-a4 and fixed before the live wire.
- [x] `attention`: runbook `restrict` is unusable on this ingress path: an allow-listed operator /32 probe answered 403 (Traefik sees the load-balancer address). Ranges were not broadened; UI/IdP start through this deploy after the internal verification passed.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one release PR on top of the launcher fix; one CI.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Launcher main-module guard**
  - [x] `isMain(url, argv1)` compares `import.meta.url` with the real path of `argv[1]`; `launch-symlink.test.mjs` runs it through a two-level symlink.
  - [x] `ci.yml` `api` filter selects the required consumers for `a4-runtime/**` (BRA4L-EX1).
- [x] **Lot 2 — Release pins and A4 deployment**
  - [x] `overlays/preprod`: API `sha256:92c85bcf…6e`, UI `sha256:97c3f3f2…a7` (anonymously pullable, `node scripts/ci/check-preprod-images.mjs`).
  - [x] `k8s-deploy-preprod` applies `overlays/preprod-a4` (BRA4C-EX1); `bundle.selftest.mjs` asserts the pinned digests on both renders.
  - [x] Lot gate: `make test-preprod-a4 ENV=test-a4-iac` (32/32) and `make test-artifact-content-manifests ENV=test-a4-iac` (156 PASS, 32/32, A4 bundle selftest PASS).
- [ ] **Lot 3 — PR**
  - [ ] PR « deploy(preprod): ship the A4 cutover release », CI green on the exact head, GLM review, merge by s-conductor; then resume `cronjob/pgbackup` (fence suspended it and the manifest has no `suspend` field).
