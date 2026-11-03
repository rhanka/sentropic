# Feature: Bounded concurrency in artifacts publish blob staging (P1 #art-conc)

## Objective
A multi-file `artifacts_publish` returns 503 `provider_unavailable` on slow S3 hosts (OVH BHS answers in 1.1–1.5 s per request) because `publishFinalized` does one `putBlob` per file in a sequential loop and `verifyStagedBlobs` does one `getBlob` per file, also sequential; 30 files take ~78 s against the host's 20 s blob budget. This branch makes both loops bounded-concurrent (default 6, configurable, never above 8) with a shared deadline, first-fatal cancellation and unchanged error projection, all-or-nothing semantics, cleanup/finalization and MCP tool definitions.

## Scope / Guardrails
- Scope limited to `packages/artifacts` (`src/server/publication.ts`, `src/mcp-core.ts` version constant, tests, CHANGELOG/package.json), the mechanical lockfile sync (`package-lock.json`, `api/package-lock.json`), the APP-P1 pin sites (`api/src/services/mcp/cluster-registry.ts` + the two api registry tests), the L5 P1 manifest (`tools/memory-mcp-l5/artifacts/**`, BR-EX5) and the cluster-mesh selected packaging fixture re-pin (BR-EX3).
- MCP tool definitions stay byte-identical: no change to `ARTIFACTS_TOOL_DEFINITIONS` or the tools/list snapshot; only `ARTIFACTS_PROVIDER_VERSION` (manifest version field) moves to 0.2.12, so the APP-P1 manifest pin is refreshed, never weakened.
- Make-only workflow; one Docker lock per make command (`flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md make ...`), never nested; tests on `ENV=test-art-conc-rb` only, ENV always last; `make down-volumes ENV=test-art-conc-rb` at the end. No `[skip ci]` anywhere.
- Branch development happens in worktree `tmp/worktrees/artifacts-publish-concurrency` (branch `fix/artifacts-publish-bounded-concurrency` from `origin/main`).
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/src/server/publication.ts`
  - `packages/artifacts/src/mcp-core.ts` (ARTIFACTS_PROVIDER_VERSION only)
  - `packages/artifacts/tests/**`
  - `packages/artifacts/CHANGELOG.md`
  - `packages/artifacts/package.json`
  - `package-lock.json` and `api/package-lock.json` — mechanical lockfile sync of the 0.2.12 version bump only (version-string-only diffs, same pattern as origin/main ddbe7b65e / 5414304b0); explicit allowed wins over the `api/**` forbidden glob
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/artifacts/src/**` except `server/publication.ts` and `mcp-core.ts` (tool definitions byte-identical; snapshot JSON untouched)
  - `api/src/**` except `api/src/services/mcp/cluster-registry.ts`
  - every other packages/cluster-mesh path stays out of scope (classified unknown); only the three BR-EX3 files are conditional below
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `tools/memory-mcp-l5/artifacts/**` (BR-EX5)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (BR-EX3)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (BR-EX3)
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` (BR-EX3)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- BR-EX5 (scope exception, `tools/memory-mcp-l5/artifacts/**`): the root lock carries @sentropic/artifacts 0.2.12 after `make lock-root`, so the committed P1 manifest no longer matches the live lock fingerprint; regenerate through `make memory-l5-pack STAGE=pre-candidate ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json` (never hand-editing digests), previous manifest+sidecar retained in `artifacts/history/`. Rollback: restore the retained history manifest/sidecar and delete the new snapshot. Precedent: e52102c4c (0.2.9).
- BR-EX3 (cluster-mesh packaging fixture re-pin): `tests/packaging/prepare-artifacts.spec.ts` requires the `selected` fixture to pin the workspace candidate version exactly, and the lazy lane installs the same-PR sibling archives whose integrity the committed lock must carry. Re-pin `fixtures/selected/package.json` + `package-lock.json` through `make pack-candidate-siblings` + `refresh-lazy-package-lock` and update the hardcoded archive integrity in `artifacts-tuple.spec.ts`. Rollback: revert the three files to the 0.2.9 pin. Precedent: bfbdd78df.
- Rebase on origin/main (3c0897b06, post-#901 sharing G1 / artifacts 0.2.10): UNION resolution — every #901 sharing change and every #art-conc concurrency change kept. Conflicts: `BRANCH.md` (this branch's content kept, BRLOCK-EX1 review_by line retained, test env moved to `test-art-conc-rb`), `packages/artifacts/package.json` + both lockfiles (0.2.12 kept per conductor allocation, above #901's 0.2.10), `mcp-core.ts` (0.2.12 version constant + #901/#896 tool definitions untouched), `CHANGELOG.md` (0.2.12 entry above #901's 0.2.10 entry), APP-P1 pin sites (`cluster-registry.ts` + the two app-mcp tests re-pinned to the 0.2.12 digest recomputed through make against the union source, #901's 0.2.8/0.2.10 refusal vectors kept), cluster-mesh fixtures + `artifacts-tuple.spec.ts` (re-pinned to 0.2.12 via the packaging make flow), L5 P1 manifest + history + lock snapshot (regenerated through `make memory-l5-pack` against the post-rebase HEAD). MCP tool definitions byte-identical; tools/list snapshot unchanged. Locks regenerated via `make lock-root` (+ documented one-line `file:` sync in `api/package-lock.json`, pattern ddbe7b65e), never hand-merged.

## AI Flaky tests
- Acceptance rule: no AI-flaky tests are involved; all tests here are deterministic (latency-injected fakes with generous margins).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single branch, single final test cycle)
- Rationale: one cohesive fix inside one package plus mechanical pin/lock/manifest sync; no parallel sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI surface change; package-level vitest lanes only (`make test-artifacts`, scoped api registry tests) on `ENV=test-art-conc-rb`.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Worktree `tmp/worktrees/artifacts-publish-concurrency` on `fix/artifacts-publish-bounded-concurrency` from `origin/main`.
  - [x] Read `packages/artifacts/src/server/publication.ts` (publishFinalized put loop ~L530, verifyStagedBlobs L191), `failures.ts` classification, `http.ts` dispatch, `mcp-core.ts` tool definitions.
  - [x] Confirm command style: `make ... ENV=test-art-conc-rb` with ENV last; one `flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md` per make command, never nested.
  - [x] Version allocation: 0.2.12 (#art-conc; #901=0.2.10, #891=0.2.11 per conductor); post-bump gate `npm view @sentropic/artifacts version` < 0.2.12.

- [x] **Lot 1 — Bounded concurrency in publication.ts**
  - [ ] Add `DEFAULT_BLOB_CONCURRENCY = 6`, `MAX_BLOB_CONCURRENCY = 8`, `resolveBlobConcurrency` (clamp to 8, reject <1/non-integer) and a shared worker-pool helper (shared `deadlineAt`, first-fatal stop, at most k in flight, original first error rethrown unchanged).
  - [ ] `verifyStagedBlobs(blobs, entries, options?)` runs getBlob read-backs through the pool (default 6); digest-then-size mismatch errors unchanged.
  - [ ] `publishFinalized` runs the putBlob loop through the pool with the per-entry intent-pending check as the pool's before-each hook; `blobConcurrency`/`blobDeadlineMs` on `GuardedPublicationDeps`; shared deadline across put and verify pools; deadline expiry throws a `TimeoutError`-named error (classifies to the same 503 provider_unavailable projection).
  - [ ] All-or-nothing unchanged: intent record, pins, finally-unpin, coordinator.finalizePrepared and compensation paths untouched; MCP tool definitions byte-identical.
  - [ ] Lot gate: `make typecheck-artifacts` + `make lint-artifacts` green on `ENV=test-art-conc-rb`.

- [x] **Lot 2 — Latency-injected tests**
  - [ ] New `packages/artifacts/tests/publication-concurrency.test.ts`: fake blob store with injected per-op latency and in-flight tracking.
  - [ ] Wall time drops close to ceil(n/k) round trips (n=30, k=6, 100 ms/op → ~500 ms, asserted well under the 3000 ms sequential time).
  - [ ] Failure in the middle rolls back cleanly: same error object rethrown, finalizePrepared never called, pins released, no visible release, no new ops started after the first fatal error.
  - [ ] Concurrency limit respected: max in-flight ≤ k for default 6, configured 3, and configured 100 (clamped to 8).
  - [ ] Error codes unchanged: sentinel provider errors classify to the identical projection (503 provider_unavailable / capability_unavailable, retriable) through `classifyArtifactFailure`; digest-mismatch read-back error unchanged; deadline expiry classifies the same.
  - [ ] Lot gate: `make test-artifacts SCOPE=tests/publication-concurrency.test.ts ENV=test-art-conc-rb`, then full `make test-artifacts ENV=test-art-conc-rb` green.

- [x] **Lot 3 — Version bump 0.2.12, CHANGELOG, locks, APP-P1 pin, L5 manifest**
  - [ ] `packages/artifacts/package.json` 0.2.9 → 0.2.12; `ARTIFACTS_PROVIDER_VERSION` = '0.2.12' in `src/mcp-core.ts`; CHANGELOG `## 0.2.12` entry above `## 0.2.9`.
  - [ ] `make lock-root ENV=test-art-conc-rb`; api lock one-line `"../packages/artifacts"` version-string bump (pattern ddbe7b65e).
  - [ ] Recompute APP-P1 manifest digest through the make test lane (temp test in `packages/artifacts/tests/`, since deleted); refresh `APP_P1_MANIFEST_DIGEST` in `api/src/services/mcp/cluster-registry.ts` + digests/version assertion in `api/tests/api/app-mcp-registry.test.ts` and `app-mcp-installed.test.ts`. Pin semantics unchanged; tools/list snapshot untouched (definitions byte-identical).
  - [ ] BR-EX3: `make pack-candidate-siblings` + `refresh-lazy-package-lock`; re-pin `fixtures/selected/package.json` + `package-lock.json` + `artifacts-tuple.spec.ts` integrity to 0.2.12.
  - [ ] BR-EX5: `make memory-l5-pack STAGE=pre-candidate ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json ENV=test-art-conc-rb`.
  - [ ] Lot gate: scoped api registry tests (`app-mcp-registry.test.ts`, `app-mcp-installed.test.ts`) green on `ENV=test-art-conc-rb`.

- [ ] **Lot N — Final validation**
  - [ ] `make test-artifacts ENV=test-art-conc-rb` green (unit suite incl. new concurrency tests).
  - [ ] `make scope-check` PASS before every commit; `harness check branch` on the worktree.
  - [ ] `make down-volumes ENV=test-art-conc-rb` (exit 0) after the test lanes.
  - [ ] Final gate step 1: `make commit`, push, open READY PR using this BRANCH.md as body.
  - [ ] Final gate step 2: exactly one CI run on the final head.
  - [ ] Report to `.tmp/rv/artifacts-publish-concurrency.md` (incl. the MCP/mcp-platform terminal-response audit). Do not merge.
