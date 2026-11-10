# Feature: Builder pod resilience (never re-adopt a dead pod, one retry, pod-cause reasons, pod TTL)

## Objective
Stop the recurring builder-pod loss loop (preprod 09/11: evicted worker pod re-adopted, supervisor_relay_502 twice): never adopt a dead or silent pod, retry a build-only transport loss once on a fresh pod, report the Kubernetes pod cause, and converge RECOVERING runtimes to DORMANT.

## Scope / Guardrails
- Scope limited to `api/src/services/artifacts/live/` (pods, build-only, prepare-live, controller, ports) and `api/tests/unit/artifacts-live/`.
- One migration max in `api/drizzle/*.sql` (none planned).
- Make-only workflow, no direct Docker commands; Docker via `.tmp/packets/docker-slot.sh make ...` in the FOREGROUND, one slot per command, never nested.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/builder-pod-resilience` (even for one active branch).
- Automated test campaigns run on dedicated environments (`ENV=test-builder-resilience`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/artifacts/live/pods.ts`
  - `api/src/services/artifacts/live/ports.ts`
  - `api/src/services/artifacts/live/build-only.ts`
  - `api/src/services/artifacts/live/prepare-live.ts`
  - `api/src/services/artifacts/live/controller.ts`
  - `api/tests/unit/artifacts-live/fixture.ts`
  - `api/tests/unit/artifacts-live/builder-pod-resilience.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `attention`: PR #991 (`fix/artifacts-worker-memory-request`, worker request=limit=1536Mi, 2 pods) is separate and still open; this branch builds on origin/main and stays compatible with either sizing (no memory value is hardcoded here).
- `attention`: PR #993 opened 2026-11-10 (head `a13cc7d48`); GitHub created no CI run on `opened` or `reopened`, so a bookkeeping commit re-triggered via `synchronize`.
- `attention`: full dispatch 42758433286 failed only on `api-image-guards` (content entrypoint `Dynamic require of "node:os"`). Root cause in branch: `pods.ts` imported `deadline` → `logger` → `pino`, and `apps/artifact-content` bundles `pods.ts` (podName) into the ESM entrypoint via esbuild. Fix: `notePodLoss` + `ensureResponsivePod` moved to API-only `pod-probe.ts`; `pods.ts` imports stay bundle-safe (records, recipe-diagnostics, recipes). Bundle repro in container: 0 `Dynamic require` shims, boot serves `200 ok` on `/healthz`.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one capability, one PR, orthogonal to other lanes; single final CI run.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this branch; no UAT checkpoints.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `.tmp/packets/COMMON-RULE.md`.
  - [x] Create isolated worktree `tmp/worktrees/builder-pod-resilience` on `fix/artifacts-builder-pod-resilience` from `origin/main` (HEAD `84263c6f`).
  - [x] Verify branch: `fix/artifacts-builder-pod-resilience`.
  - [x] Capture Makefile targets for debug/testing (`make test-api`, `make typecheck-api`, `docker-slot.sh`).
  - [x] Define environment mapping: `ENV=test-builder-resilience`, `API_PORT=8933`, `UI_PORT=5333`, `MAILDEV_UI_PORT=1233`.
  - [x] Confirm command style: `.tmp/packets/docker-slot.sh make ... ENV=test-builder-resilience` with `ENV` last, FOREGROUND only.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (Allowed/Forbidden/Conditional); no `BRxx-EXn` needed.
- [x] **Lot 1 — Never adopt a dead or silent pod**
  - [x] `pods.ts`: widen `Pod` status (phase, reason Evicted, message, containerStatuses terminated OOMKilled) and `metadata.creationTimestamp`.
  - [x] `pods.ts`: `classifyPodLoss` (pod_evicted, pod_oomkilled, pod_gone, pod_unavailable, supervisor_unresponsive) with bounded scrubbed k8s detail.
  - [x] `pods.ts`: `ensure` returns `{uid, adopted, phase, creationTimestamp}`; fresh intent on a Failed/Succeeded/terminating matching pod deletes it and recreates (fenced by uid + waitDeleted); fenced own-pod path throws the classified cause.
  - [x] `pods.ts`: `ensureResponsivePod` (bounded renew probe on adopted Running pods older than the boot grace; on transport failure delete + recreate once inside the heavy pod slot).
  - [x] `ports.ts`: `pods.ensure` new return shape + new `pods.describe`.
  - [x] `prepare-live.ts` + `build-only.ts`: adopt via `ensureResponsivePod`.
  - [x] `fixture.ts`: fake create sets `creationTimestamp` + `Pending` phase.
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=test-builder-resilience` (via docker-slot.sh) green.
    - [x] `make lint-api ENV=test-builder-resilience` green.
    - [x] **API tests**
      - [x] Existing: `api/tests/unit/artifacts-live/pods.test.ts`, `oom.test.ts`, `controller.test.ts`, `reaper.test.ts` unchanged and green (57 tests, 5 files with the new file).
      - [x] New: `api/tests/unit/artifacts-live/builder-pod-resilience.test.ts` case (a): adopted silent pod deleted + recreated, job succeeds.
      - [x] Scoped runs: `make test-api SCOPE=tests/unit/artifacts-live/builder-pod-resilience.test.ts API_PORT=8933 UI_PORT=5333 MAILDEV_UI_PORT=1233 ENV=test-builder-resilience` (10/10 green).
    - [x] **UI tests (TypeScript only)**
      - [x] None: no UI change.
    - [x] **E2E tests**
      - [x] None in branch: GitHub CI runs the rest.
- [x] **Lot 2 — One retry on transport loss with pod cause**
  - [x] `pods.ts`: `isTransportLoss` (retryable: pod_evicted, pod_gone, pod_unavailable, supervisor_unresponsive, supervisor_relay_5xx, supervisor_relay_unreachable, supervisor_channel_aborted, k8s_unreachable, k8s_timeout); deterministic failures (install_failed:*, build_failed:*, verify*, publication_*, git_*) never retry; pod_oomkilled never retries.
  - [x] `pods.ts`: `enrichPodLoss` (relay/channel failure + readable pod status becomes the pod cause; keeps relay reason when k8s is unreadable or the pod never started).
  - [x] `build-only.ts`: extract create/resolve/attempt; transport loss enriches, emits one `artifact_live_phase` `pod` fail line (reason + k8s detail), tears down, re-resolves the same jobId with a new attempt fence, retries once; second failure is reported.
  - [x] `controller.ts`: LIVE reconcile enriches the ensure failure (Pending boot race keeps `supervisor_relay_502`); teardown + crash-restore unchanged.
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=test-builder-resilience` (via docker-slot.sh) green.
    - [x] `make lint-api ENV=test-builder-resilience` green.
    - [x] **API tests**
      - [x] New cases (b): eviction mid-build retries once on a fresh pod and succeeds; (c): deterministic build_failed does not retry and tears down; (d): reasons carry pod_evicted / pod_oomkilled; (e): tick converges RECOVERING with gone/evicted pod to DORMANT.
      - [x] Full scoped file green (10/10) + neighbours (57/57 across 5 files).
    - [x] **UI tests (TypeScript only)**
      - [x] None: no UI change.
    - [x] **E2E tests**
      - [x] None in branch: GitHub CI runs the rest.
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest API (Lot 1 + Lot 2 scoped files + neighbours)
  - [ ] Retest UI: none (no UI change)
  - [ ] Retest e2e: none in branch (CI)
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] Bumped affected `packages/<pkg>/package.json` version: none (no `packages/<pkg>/src/**` change)
  - [ ] Final gate step 1: create/update PR with `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers (unrelated UI e2e failure recorded below with fresh head).
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
