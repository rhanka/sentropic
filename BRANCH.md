# Feature: A-LIVE W7 — builder service, host build API and SG4b two-step handoff (M3-B)

## Objective
- [ ] Builder service composition, authenticated host build API (job by id, never a caller SHA) and the A-LIVE §8.4 two-step SG4b handoff, coded against the W3 `QualifiedSupervisor` port. Code only: merge and activation wait for the GB4-P go (A-LIVE §10).

## Scope / Guardrails
- [x] Branch feat/alive-w7 from origin/main 3f1027496; worktree tmp/worktrees/alive-w7; ENV=test-alive-w7.
- [x] Plan .tmp/rv/alive-enablement-plan.md (W7, lot M3-B); contracts A-LIVE v2 and G0 v3; immo reservations R1-R5.
- [x] Make only; no Python, attribution trailers, CI skips, reruns or CI polling; never ENV=dev.
- [x] Wagon: push the branch, no PR, no version bump, no lock or manifest regeneration.
- [x] Pod resources and NODE_OPTIONS belong to wagon feat/alive-pod-4live (plan r3.5); not changed here.
- [x] Nothing deployed or activated on any cluster.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/live/**`
  - `api/tests/unit/artifacts-live/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `apps/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (none planned: the handoff ledger reuses `control.artifact_host_kv`)
  - `.github/workflows/**`

## Feedback Loop
- [ ] `attention`: W3 port has no method to export the verified candidate bytes; W7 injects a `CandidateExport` port (open question to W3).
- [ ] `attention`: the host-side verifier must be packaged for immo (W10); placement is an open question.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** (wagon merged by the train integration lane)

## Plan / Todo (lot-based)
- [ ] **Lot 1 — SG4b two-step handoff**
  - [ ] Ed25519 single-use authorization bound to job, generation, commit, candidate, run and attempt; 10-minute lifetime.
  - [ ] Host verifier: mandatory evidence, foreign scope/job, replay, expiry, altered bytes, stored-bytes re-read, response-loss replay.
  - [ ] Builder publication port: anti-repack check, durable intent, bounded resend, receipt verification, idempotent record.
- [ ] **Lot 2 — Host build API and builder service**
  - [ ] Authenticated host identity; job by id; asynchronous build with job-bound status.
  - [ ] Scheduler sweep (reconcile, reap, recover) exposed, never started.
  - [ ] Composition with the handoff publication; host-selected live recipe path.
- [ ] **Lot 3 — Gate**
  - [ ] Scoped checks: `make -f .tmp/packets/alive-w7-ops.mk w7-check` (tsc + vitest on api/tests/unit/artifacts-live).
  - [ ] Push the wagon; report .tmp/rv/alive-W3-W7.md.
