# Feature: isolated pgbackup restore with B03 manifest (W0-close.b)

## Objective
Extend `k8s-pgbackup-restore` to restore into the isolated namespace/PG/DB only, with strict pre-write guards and a B03 backup/object manifest.

## Scope / Guardrails
- [x] Scope limited to `k8s-pgbackup-restore`, its runbook and its isolation guard test.
- [x] Make-only workflow, no direct Docker commands.
- [x] Work in `tmp/worktrees/app-w0-restore`, `ENV=test-app-w0-restore` last, never `ENV=dev`.
- [x] All new text in English.
- [x] No secrets in output; credentials referenced by name only.
- [x] 0 Python; the guard test is POSIX sh.
- [x] `k8s-db-restore-preprod` stays excluded and untouched.
- [x] No restore against a real cluster in this lot; W0-close.c execution is tenant-owned.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `docs/runbooks/app-cm-baseline-restore.md`
  - `scripts/test-pgbackup-restore-isolation.sh`
  - `Makefile` (`k8s-pgbackup-restore` block, its `RESTORE_*` variables and the `test-pgbackup-restore-isolation` target only, under W0-EX1)
  - `.github/workflows/ci.yml` (`global` filter entry plus one guard-test step only, under W0-EX1)
  - `deploy/k8s/README.md` (restore paragraph only, under W0-EX1)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile` outside the leased blocks
  - `k8s-db-restore-preprod` target block
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `docs/baselines/app-cm-w0/**`
  - `deploy/**` outside the leased README paragraph
  - `.github/workflows/**` outside the leased hunk
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - _(none; the Makefile lease is Allowed under W0-EX1)_
- **Exception process**:
  - [x] Declare exception ID `W0-EX1` in `## Feedback Loop` before touching the conditional path.

## Feedback Loop
- [x] `W0-EX1` — narrow Makefile lease for Lane B (plan-v2 W0-close.b row plus packet `app-W0-close-b.md`; Sol leases the edit to Lane B).
  - [x] Reason: the repo is Make-only, so the isolation guards must live in the existing restore target.
  - [x] Impact: `k8s-pgbackup-restore` block plus `RESTORE_*` variables only; no other target touched.
  - [x] Rollback: revert the Makefile hunk of the Lot 1 commit.
- [x] `W0-EX1` extension (Opus r1 review of PR #756, user-ordered 2026-10-26).
  - [x] Reason: fix the 3 P1 + 7 P2 production-reachability findings in the leased target, wire its guard test into make/CI, and update the stale `deploy/k8s/README.md` restore paragraph that invites admin-kubeconfig use.
  - [x] Impact: `k8s-pgbackup-restore` block rework, one new `test-pgbackup-restore-isolation` target, one `global`-filter entry plus one step in `ci.yml`, one README paragraph. No other target, job or doc touched.
  - [x] Rollback: revert the R1 hunks commit by commit.

## AI Flaky tests
- [x] No AI-dependent tests; the isolation guard test is deterministic shell with a fake kubectl shim.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single focused lot, one test cycle)
- [ ] **Multi-branch** (not applicable)
- [x] Rationale: one target, one runbook, one test; no parallel sub-workstreams.

## UAT Management (in orchestration context)
- [x] No UI surface and no cluster execution in this lot; no UAT.
- [x] Real-cluster restore (W0-close.c) is tenant-owned and out of scope.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Reuse branch `feat/app-cm-w0-restore-isolation` at `origin/main` in `tmp/worktrees/app-w0-restore`.
  - [x] Read packet, DOCKER-LOCK, plan-v2 W0-close.b row, Sol r2 review, MASTER rules, both skills.
  - [x] No compose stack in this lot (fake-kubectl guard tests only); no ports allocated.
  - [x] `harness check branch` passes on this BRANCH.md.
- [x] **Lot 1 — Makefile guards plus manifest (W0-EX1)**
  - [x] Reject prod/preprod PG, namespaces and buckets; refuse absent identity and unsafe defaults, all before any write.
  - [x] Remove swallowed checksum/count failures; print the B03 manifest block.
  - [x] `make -n` dry-run plus `scope-check` before commit.
- [x] **Lot 2 — Runbook plus isolation test**
  - [x] `docs/runbooks/app-cm-baseline-restore.md` with the exact tenant command for W0-close.c.
  - [x] `scripts/test-pgbackup-restore-isolation.sh` (shell, fake kubectl, no cluster).
- [x] **Lot 3 — Local guard verification**
  - [x] Run the isolation test green with `ENV=test-app-w0-restore` last.
  - [x] Prove no kubectl write precedes a guard failure.
- [ ] **Lot 4 — Final validation**
  - [x] `make scope-check` before each commit; atomic `make commit` per file group, each under 150 lines.
  - [ ] Push, open draft PR #756 (base `main`: repo CI triggers only for main-targeted PRs; retarget to `feat/app-cm-w0-baseline` at W0-close.e integration), CI green; do not merge.
- [ ] **Lot R1 — Opus r1 fixes (user-ordered 2026-10-26, PR #756 stays draft on main)**
  - [x] Extend the guard test first (red): default/admin identity, pod-spec without s5cmd in main, strict key, allowlist probes, secret/sha validation.
  - [ ] P1: explicit `RESTORE_KUBECONFIG` plus negative prod/preprod `can-i`; meta-collecting initContainer; pipefail/`ON_ERROR_STOP`/`gzip -t`/required sha compare.
  - [ ] P2: case-insensitive host/IP/namespace allowlists, `^[a-z0-9-]+$` secrets, distinct defaults, ETag (+versions best-effort), receipts outside repo, `bash` runbook, make+CI wiring, README update, PR-body do-not-merge line.
  - [ ] Test green, scope-checks, atomic commits, push, CI green; do not merge.
