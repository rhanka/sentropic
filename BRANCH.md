# Feature: Preprod auto-repin and artifact data guard (T1)

## Objective
- [ ] deploy-preprod pins overlays/preprod to the deployed commit's images: same-run publications first, else the commit's immutable content tag; no repin PR per wagon (inventory 3.1.10).
- [ ] CI fails any change that deletes artifact tables, the artifact object store, its volume or a bucket (owner rule 2026-11-08 « never delete artifact data »).

## Scope / Guardrails
- [x] Branch fix/ci-preprod-auto-repin from origin/main c22163106; worktree tmp/worktrees/t1-ci-preprod-auto-repin; ENV=test-t1-repin; no service stack (ports unused).
- [x] Make only; no Python; no attribution trailers; no version bump, lock or fixture regeneration (train lane); no PR (train T1 assembles).
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/ci/preprod-repin.mjs`
  - `scripts/ci/preprod-repin.test.mjs`
  - `deploy/ci/artifact-data-guard/**`
  - `deploy/k8s/overlays/preprod/kustomization.yaml`
  - `deploy/ci/artifact-content/object-store/README.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `api/**`
  - `ui/**`
  - `packages/**`
  - `deploy/ci/preprod-a4/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (BRREPIN-EX1)
  - `.github/workflows/ci.yml` (BRREPIN-EX2)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] BRREPIN-EX1: `Makefile` — `preprod-repin` target, `k8s-deploy-preprod` drops the dead `newTag` append (never fired once a digest block was committed), `test-ghcr-images` runs the repin tests, include of `deploy/ci/artifact-data-guard/targets.mk`, `k8s-db-restore-preprod` refuses to restore over preprod artifact rows. Impact: CD and the manual restore only. Rollback: revert the commit.
- [x] BRREPIN-EX2: `.github/workflows/ci.yml` — deploy-preprod downloads the same-run publications and runs `make preprod-repin` before the pull check and the apply; validate-publishable-manifests (every run, no path filter) runs `make test-artifact-data-guard`. Rollback: revert the commit.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command). Not applicable: no AI test in scope.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**
- Rationale: one wagon of train T1; the train lane merges it, runs one CI and owns the PR.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Auto-repin**
  - [x] Tests first: `scripts/ci/preprod-repin.test.mjs` (same-run publication, content-tag pin for an unpublished kind, stale receipt, tag/publication mismatch, fail closed, hold, layout, CI step order).
  - [x] `scripts/ci/preprod-repin.mjs` + committed overlay comment (pins = render baseline; `# preprod-image-hold: <reason>` keeps them).
- [x] **Lot 2 — Artifact data guard**
  - [x] Tests first: `deploy/ci/artifact-data-guard/guard.test.mjs` (SQL, commands, rendered tiers, restore refusal).
  - [x] `guard.mjs` (whole-tree scan + rendered prod/preprod/preprod-a4) and `refuse-artifact-data.sql`.
  - [x] Object store README rollback keeps the PVC and bucket.
- [x] **Lot 3 — Wiring (BRREPIN-EX1, BRREPIN-EX2)**
  - [x] Makefile targets and CI steps.
- [x] **Lot 4 — Validation**
  - [x] `docker-slot.sh make test-ghcr-images ENV=test-t1-repin`: 45/45 PASS.
  - [x] `docker-slot.sh make test-artifact-data-guard ENV=test-t1-repin`: 7/7 + whole-tree scan PASS; planted `DROP TABLE artifacts.records` fails closed (`ARTIFACT DATA GUARD ... drop-table`, exit 1), removed after.
  - [x] Live smoke: `API_VERSION=71a3bd UI_VERSION=81fa0d make preprod-repin PREPROD_PUBLISHED_KINDS=` resolves both digests anonymously and rewrites the pins (file restored after, tree clean).
  - [ ] Argon read-only review `.h2a/reviews/t1-fix-ci-preprod-auto-repin-argon.md` (Opus unavailable: quota; resume lane).
