# Feature: Sandbox Node K1 — clean startup, quota errors and isolation qualification

## Objective
Deliver packet s1-agent-k1 Fixes 1–5 on fix/sandbox-node-k1 in tmp/worktrees/sandbox-node-k1. Preserve the inherited delivery history below; no merge, deployment or VM access.

## Scope / Guardrails
- [x] Isolated worktree `tmp/worktrees/artifacts-live-drafts`, branch `fix/artifacts-live-drafts-outcome`, base `12af1431a2b4b6e80b08ae3f997bd51b34da612a`.
- [x] Make-only, Docker-first; Docker commands use the shared docker-slot wrapper; no timeout increases.
- [x] Environment `test-artifacts-drafts`; API_PORT=9685, UI_PORT=5885, MAILDEV_UI_PORT=1785 checked free with `ss -ltn`.
- [x] No dev environment, clean-all, merge, or unrelated changes.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `apps/sandbox-node/**`
  - `spec/SPEC_EVOL_SANDBOX_NODE.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] No scope exception required.

## Feedback Loop
- [x] Track source is this branch file; import remains with the conductor as designated single writer; no concurrent `.track` writes.

## AI Flaky tests
- [x] No AI tests or flaky acceptance apply.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, independent read-only code review; no integration or cherry-pick.

## UAT Management (in orchestration context)
- [x] No UI surface changes; memory and Postgres conformance qualify the behavior.

## Plan / Todo (lot-based)
- [x] K1 Lot 0: verified existing branch with harness; ENV=test-sandbox-node-k1; no stack or ports started.
- [x] K1 Fix 1: normalize literal null runsc lists only; restart/lost+found/garbage regressions in restart.test.ts and runtime cleanup coverage.
- [ ] K1 Fixes 4–5: shared code-or-errno recognition; qualification/source/runtime/export regressions; audit all requested error codes.
- [ ] K1 Fix 2: real-adapter two-tenant isolation qualification, standalone SEA command, shipped shell wrapper and cleanup checks.
- [ ] K1 Fix 3: archive root 0755, verification and operator custody modes.
- [ ] K1 final: check-sandbox-node, build/verify artifact, code review, push PR and wait for green CI; RUN 9 and done marker.
- [x] RUN 2 CI fixes: user-owned cache qualifies 31/31; exact Responses session-title regression reproduced red, then fixture amended without relaxing unknown-traffic rejection.
- [x] RUN 2 build: compiled digest-addressed archive produced locally; reuse locked dependency download cache after observed registry ETIMEDOUT, without host node_modules.
- [x] RUN 2: real adapter reads complete memory.current via validated systemd tenant slice; update local exports and standalone qualification instructions.
- [x] RUN 2 AMD-3/6/7: compile-time incomplete provenance rejection, truthful stop union, strict isolate policy and canonical recipe digest/path collision regressions.
- [x] RUN 2: CI executes standalone regression suite; spec adds provenance/S2 recipe and staged d2-4 qualification gates.
- [x] RUN 2 spec: apply normative AMD-1/2/4/5/7/8/9/10/11/12 tenant, scope, admission, transport and lifecycle amendments.
- [x] RUN 2 regression checks: pending stop retains reservation, export refuses until quiescence, concurrent claims serialize and rejected admissions can retry.
- [x] RUN 2: build digest-addressed compiled Node release with immutable archive/file manifests; no package or image publication required.
- [x] RUN 2 AMD-12: operator guide targets poc-k8s cloud-init/systemd, public mTLS, no Python, job-alerts, digest rollback and d2-4 resources.
- [x] RUN 2: runnable mTLS bootstrap service and real job-alerts scheduling; supportedOps honestly limited to node/quotas pending S1 host lifecycle qualification.
- [x] RUN 2 AMD-5/12: mTLS listener, explicit operator/tenant scope boundary and verified HTTPS job-alerts heartbeat; authentication regression tests.
- [x] RUN 2 AMD-12: remove inapplicable DaemonSet; standalone systemd agent unit and digest-only verified release startup for k8s cloud-init ownership.
- [x] RUN 2 AMD-3/6/7/11: provenance payload and S2 recipe/isolation contract; epoch 2 then late epoch 1, restart, stream closure and heartbeat regression tests.
- [x] RUN 2 AMD-4/11: monotone custody WAL fsync before acknowledgement, active stream closure, stale reconnection/invocation refusal and heartbeat fail-closed gate.
- [x] RUN 2 AMD-2: wire scope stop results and quiescence export guard; real export fails closed until its reader is installed.
- [x] RUN 2 AMD-2/9: resolve systemd ControlGroup, validate tenant ancestry before writes, kill only scope and poll populated; mismatch/timeout regression tests.
- [x] RUN 2 AMD-1/8: account complete memory.current and fixed 768/1664 MiB reservations, reject memory pressure before OOM; capacity regression tests.
- [x] RUN 2: wire publish admission into daemon, warm claim transfer, canonical builder storage; standalone container qualification target.
- [x] RUN 2 AMD-8/10: warm live OR standby admission, rejection before allocation and reservation transfer tests.
- [x] RUN 2 AMD-10: bounded single global publish queue with strict tenant alternation and queue-full rejection tests.
- [x] RUN 2 AMD-8: freeze d2-4 capacity, per-tenant limits, quota snapshots and stop/scope response types locally.
- [x] RUN 2: verify feat/sandbox-node-step1 mechanically; restore registry-compatible contracts and consume new types locally.
- [x] RUN 2: apply AMD-1..12, d2-4 admission, custody, scope resolution, VM operator contract and regression tests (30 passing before release-start tests).
- [ ] RUN 2: push atomic commits, verify CI green, append evidence to s1-agent-core.md; do not merge or deploy.
- [x] **Lot 0 — Baseline & constraints**
  - [x] Verify branch `feat/sandbox-node-step1` tracks `origin/main` (`5be8e34f3`) in worktree `tmp/worktrees/sandbox-node` before any edit.
  - [x] Confirm scope and guardrails (Allowed/Forbidden above; `Makefile` and `deploy/**` untouched).
- [x] **Lot 1 — Spec freeze**
  - [x] Write `spec/SPEC_EVOL_SANDBOX_NODE.md` (English): ExecutionNodeV1 + tenant model frozen; open points (D2/D3/D4/D5/D6/D7/D14) explicitly marked non-frozen.
- [x] **Lot 2 — Contract module**
  - [x] Consume unreleased contract in `apps/sandbox-node/src/contract.ts`; leave published contracts untouched.
  - [x] Lot gate: `tsc --noEmit` on `packages/contracts` passes; `git status` shows no `Makefile`, `docker-compose*.yml`, `api/**`, `ui/**`, `deploy/**` changes.
- [x] **Lot S1-A1a — Sandbox-node daemon (apps/sandbox-node, Node/TS, zero Python)**
  - [x] Daemon against injectable runtime adapter (`src/runtime-adapter.ts`: fake for tests, real `runsc --network=none` systrap compile-safe).
  - [x] Per-tenant read-only base mounts + `/workspace`-only writes (`src/mounts.ts`).
  - [x] Lifecycle automaton + idempotence + ticket verification (`src/daemon.ts`, `src/tickets.ts`).
  - [x] Per-tenant admission/quotas + WFQ 1:1 drain + audit events (`src/admission.ts`, `src/audit.ts`).
  - [x] Unit tests written: tenant isolation, lifecycle incl. stop->export->destroy, tickets, admission fairness, adapters.
  - [x] Typecheck `apps/sandbox-node` via `exec-api` on `ENV=test-sandbox-node` (green).
  - [x] Unit tests green via `test-api-endpoints SCOPE=apps/sandbox-node/tests` on `ENV=test-sandbox-node` (5 files, 16 tests).
- [ ] **Lot N — Final validation**
  - [x] Typecheck & lint for the touched package (`make typecheck-api` exit 0 on 2026-11-12; scoped vitest 16/16; eslint clean on identical `.ts` per S1-A1a).
  - [x] Keep published contracts 0.3.0 and its lock/index unchanged from base; no publication.
  - [ ] Final gate step 1: create/update PR using this `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run/verify branch CI on that PR.
  - [x] Owner constraint: preserve BRANCH.md for follow-up, do not merge or deploy.
