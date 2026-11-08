# Feature: Artifacts live status/start without tree walk under the lock, and the generic live worker draft stager (0.2.24)

## Objective
- [x] `artifacts_live_status` returns `liveRevision`, head, `bindingGeneration` and draft state without a tree walk; no forge call inside the per-artifact advisory-locked draft transaction (immo preprod 08/11 13:00: 502, `idle in transaction` on `live_drafts`, advisory lock timeouts).
- [x] `artifacts_live_control` start resolves the head and base tree SHA outside the locked transaction, with no snapshot walk.
- [ ] `live_read` narrow path set without a full tree walk: not covered in 0.2.24 (the walk now runs outside the lock; per-file reads stay under it).
- [x] `@sentropic/artifacts/live-host` `createLiveWorkerClient`: stages the current draft (`v1/live/draft/page` x N, then `v1/live/draft/seal`) before every `v1/live/reconcile`, sends `ownerId` from the live record runtime, and takes the draft overlay from a host port (`drafts`), so every host supplies it (Track 01M6Y6VN91VYTJCZ8J10A87MSB; replaces the immo bridge #1042).
- [x] Release `@sentropic/artifacts` 0.2.24 with `ARTIFACTS_PROVIDER_VERSION`, the APP-P1 digest repin and the cluster-mesh selected fixture.

## Scope / Guardrails
- [x] Branch fix/artifacts-live-status-no-walk from origin/main c22163106; worktree tmp/worktrees/artifacts-0224; ENV=test-art-0224.
- [x] Stager lane: local branch feat/artifacts-live-worker-stager from origin/fix/artifacts-live-status-no-walk 8abe1a710, fast-forward pushes only; worktree tmp/worktrees/artifacts-live-stager; ENV=test-art-stager; ports API 9263, UI 5463, Maildev 1363.
- [x] A-LIVE v2 frozen surface: additive host code only (no frozen JSON definition, descriptor, manifest, codec or tool change); no amendment required.
- [x] Make only; no Python; no attribution trailers; no CI skip or rerun; never ENV=dev.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/server/live-service.ts`
  - `packages/artifacts/tests/live-status-no-walk.test.ts`
  - `packages/artifacts/src/mcp-core.ts`
  - `packages/artifacts/package.json`
  - `packages/artifacts/CHANGELOG.md`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/mcp-workspaces-list-dispatch.test.ts`
  - `packages/artifacts/src/live-host/index.ts`
  - `packages/artifacts/src/live-host/draft-stager.ts`
  - `packages/artifacts/src/live-host/worker-client.ts`
  - `packages/artifacts/tests/live-host-worker-client.test.ts`
  - `packages/artifacts/tests/fixtures/live-worker.ts`
  - `packages/artifacts/tests/live-host-worker-client-serial.test.ts`
  - `api/tests/unit/artifacts-live/host-live-worker-client.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `ui/**`
  - `deploy/**`
  - `packages/cluster-mesh/src/**`
  - `packages/cluster-mesh/package.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json`
  - `api/package-lock.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/**`
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] BRLW-EX1: root and api lock workspace entries follow artifacts 0.2.24 (version strings only), as BRGH-EX1 did. Rollback: revert with the bump.
- [x] BRLW-EX2: the cluster-mesh selected packaging fixture follows artifacts 0.2.24 (version strings plus the integrity pin of the locally packed `make pack-artifacts` archive, sha256 e899aa65… after the CHANGELOG wording fix equals the manifest guard; pack deterministic over two runs), mirrored in `artifacts-tuple.spec.ts`, as BRGH-EX2 did. Impact: test fixtures only. Rollback: revert with the bump. Stager lane: repacked at f12786e0c (sha256 a178af46…, identical over two packs), integrity sha512-3LjItdWd… pinned in both files.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command).
- [ ] test-e2e (1) failed on c5357329d (run 42527741978: 01-admin-users:65, 07-import-export:97, 07-matrix:420 and :477, element not found). Same tests passed on 8abe1a710 (run 42510180944) and on the #967 head; the delta touches no ui/admin/matrix path (packages/artifacts live-host stager, api unit test, main merge of #967/#968). Not accepted as flaky until a fresh run on this head passes; no rerun, no skip, no timeout change.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one owner-urgent fix PR, one CI.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Forge I/O outside the draft lock**
  - [x] `live-service.ts`: short fence read, then base tree SHA (`inspectCommit`) or snapshot (entry-listing reads only) and fast-forward checks outside the lock; the locked transaction re-checks the fence (3 attempts, then `transition_busy`); forge failures surface at their original use site.
- [x] **Lot 2 — Tests**
  - [x] `tests/live-status-no-walk.test.ts`: status then start with status' head and revision against a fake GitHub HTTP with a large tree (no `/git/trees` call, no forge call under the lock); moved head fast-forward outside the lock; status not blocked by a concurrent slow forge call (covers the stale-fence retry).
- [x] **Lot 3 — Release 0.2.24**
  - [x] package, locks, `ARTIFACTS_PROVIDER_VERSION`, APP-P1 digest 428a7527 to 858aba03 (version field only), cluster-mesh selected fixture, CHANGELOG.
  - [x] Opus review r1 (.h2a/reviews/pr-966-opus.md) APPROVE; minor-1: CHANGELOG and comment narrowed to the tree walk, commit lookup and ancestry checks (live_read page and live_write edit reads stay under the lock); archive repacked and fixture integrity repinned.
- [x] **Lot 3b — Generic live worker draft stager (0.2.24)**
  - [x] `live-host/draft-stager.ts`: `planLiveDraft` (closed PAGE and SEAL bodies; 255 paths, 1 MiB per file, 8 MiB, 1 MiB per page, 32 non-empty pages; clean draft = `pages: 0`, `deletes: []`, `treeSha` = live tree), `stageLiveDraft`, `liveStoreDrafts(store, keys)`.
  - [x] `live-host/worker-client.ts`: `createLiveWorkerClient` (binding of the exact generation, runtime fences and `ownerId`, stage, then reconcile; stop 204), `liveStoreFences(store)`.
  - [x] `tests/live-host-worker-client.test.ts` against a fake builder host with the host live API rules (8 tests); `api/tests/unit/artifacts-live/host-live-worker-client.test.ts` against the real `createHostLiveApi`.
  - [x] Opus review (.h2a/reviews/pr-966-opus-stager.md) REQUEST_CHANGES, no blocker. M1 fixed: one stage+reconcile or stop at a time per artifact in the client (a late seal never overwrites a newer revision; each queued run reads the draft when it starts). M2 fixed: reconcile timeout 30 s (builder live wait 25 s), page/seal/stop 10 s. m2 fixed: epoch floor keyed by storage scope. M3: pin refreshed below (BRLW-EX2). `tests/live-host-worker-client-serial.test.ts` covers M1, M2 and m2.
  - [x] Local: `docker-slot.sh make test-artifacts SCOPE=tests/live-host-worker-client ENV=test-art-stager` PASS (2 files, 12 tests, includes the tsc build); `make lint-artifacts` 0 errors (3 warnings in untouched files-parity-lot2.test.ts); `make pack-artifacts` PASS. The api test was not run locally (no Docker slot for the api stack); it runs in the CI.
  - [ ] Not covered: cross-replica ordering of seals (needs a monotonic sequence in the SEAL body, a contract change); builder refusal codes are not surfaced (m1).
- [ ] **Lot 4 — Final validation**
  - [x] `docker-slot.sh make test-artifacts ENV=test-art-0224` PASS (98 files, 990 tests); `make typecheck-artifacts` PASS.
  - [ ] PR #966, CI green on the exact head (run 42509099686: only test-e2e (1) failed on the known 07-matrix:477 lock/presence flake, same signature as run 42459620840), merge by s-conductor.
