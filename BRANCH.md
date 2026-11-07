# Feature: A-LIVE W8 live reconciliation, multi-user authority and heavy-phase gate

## Objective
- [ ] Reconcile the package LiveService (string revisions, durable ACK) with the API live controller (wake/project), enforce the binding owner as the only writer with invited readers, admit users fairly, serialize every heavy phase per node and restore OOM-killed pods with no acknowledged edit lost (plan r3.5, A-LIVE v2).

## Scope / Guardrails
- [x] Branch feat/alive-w8 from origin/main 3f1027496; worktree tmp/worktrees/alive-w8; ENV=test-alive-w8.
- [x] Make only; no Python, attribution trailers, CI skips, reruns or CI polling; wagon push, no PR.
- [x] Code only: no deploy or cluster activation before the GB4-P go (A-LIVE §10).
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/live/**`
  - `api/tests/unit/artifacts-live/**`
  - `packages/artifacts/tests/live-tools-multiuser.test.ts`
  - `packages/artifacts/tests/fixtures/live-world.ts`
  - `packages/cluster-mesh/tests/heavy-phase-queue.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/*/src/**`
  - `packages/*/package.json`
  - `package-lock.json`
  - `api/drizzle/*.sql`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `packages/artifacts/src/server/live-store.ts` (BRW8-EX1)
  - `packages/artifacts/src/server/live-mutations.ts` (BRW8-EX1)
  - `packages/artifacts/src/server/live-read.ts` (BRW8-EX1)
  - `packages/cluster-mesh/src/runtime/heavy-phase-queue.ts` (BRW8-EX2)
  - `packages/cluster-mesh/src/index.ts` (BRW8-EX2)

## Feedback Loop
- [x] attention: the A-LIVE §3.3 contract keeps live_status owner-only, while plan Δ4 lists live_status for invitees; the contract wins and the package is unchanged.
- [x] BRW8-EX1: the package LiveService runtime record follows A-LIVE Amendment 1 (idleDeadline = lastAccessAt + 900 s, maximumLifetimeAt removed); impact: three package server files, no export or version change; rollback: revert the BRW8-EX1 commit.
- [x] BRW8-EX2: owner decision « Cluster mesh gère la file »; cluster-mesh had no heavy-phase queue, so it gains a durable FIFO with memory-budget admission and status (one module, one root export); impact: no version, package.json or lock change; rollback: revert the BRW8-EX2 commits.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: W8 is one wagon of the alive train; the integration lane merges it.

## Plan / Todo (lot-based)
- [x] Lot 1: string revisions end to end, LiveWorkerPort bridge (wake before edit, project after the durable ACK).
- [x] Lot 2: fair admission across users and invitation route fencing.
- [x] Lot 3: per-node heavy-phase gate over revive, wake, crash restore, idle and explicit clean builds.
- [x] Lot 4: bounded OOM crash restore of the acknowledged draft; package OOM and invitee tests.
- [x] Lot 5: binding-owner authority and invitee read grants for the host live assertion.
- [x] Lot gate: scoped checks green (tsc live scope, eslint live scope, api artifacts-live 83/83, package live-tools 17/17).
- [x] Lot 6: idle reaper strictly after 900 s ending on the clean build, no absolute lifetime (A-LIVE Amendment 1).
- [x] Lot 7: liveness lease frame at most every 60 s while not DORMANT and a concurrent scheduler.
- [x] Lot 8: admission survives an API restart, capacity from per-env config, bridge.stop lease fence, bounded opaque revision (review R1/R2).
- [x] Lot 9: package live idle deadline at 900 s with no absolute lifetime (BRW8-EX1).
- [x] Lot 10: scoped checks green after the review and Amendment 1 (tsc and eslint live scope, api artifacts-live 104/104, package live-tools 18/18).
- [x] Lot 11: cluster-mesh durable FIFO heavy-phase queue under the node memory budget (BRW8-EX2).
- [x] Lot 12: heavy gate as a queue client for install, pre-bundle, dev and build; 4-live admission; queued status.
- [x] Lot 13: idle build waits durably in BUILD_QUEUED after its live stops.
- [x] Lot 14: scoped checks green after the queue (tsc and eslint live scope and queue, api artifacts-live 107/107, cluster-mesh queue 7/7).
- [ ] Lot N: train integration CI green on the exact head.
