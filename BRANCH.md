# Feature: Terminal JSON-RPC responses on every MCP HTTP request (mcp-platform hono + api registry dispatch)

## Objective
After an artifacts provider 503 on immo preprod, a claude.ai tool card stayed « running » for over an hour because the client never received a terminal JSON-RPC response for its request id (audit: `.tmp/rv/artifacts-publish-concurrency.md`, section « MCP / mcp-platform terminal-response audit »). Every JSON-RPC request (POST / with an id) must always receive a terminal JSON-RPC response carrying its id — a projected result or a JSON-RPC error object with a stable code, never a bare 500/403 text and never a leak of internals. On the /mcp streamable transport the SSE stream must close after the terminal response, including on a throw.

## Scope / Guardrails
- Scope limited to `packages/mcp-platform/src/hono.ts`, `packages/mcp-platform/src/tool-configuration.ts`, `packages/mcp-platform/tests/**`, `packages/mcp-platform/package.json`, `packages/mcp-platform/CHANGELOG.md`, `api/src/services/mcp/registry-dispatch.ts`, `api/tests/api/**`, `BRANCH.md`, plus the mechanical pin/lock/manifest files listed under Conditional Paths.
- REST `/invoke` behaviour stays as it is apart from never hanging. MCP tool definitions stay byte-identical (tools/list snapshot test unchanged).
- Make-only workflow, Docker-first; tests on `ENV=test-mcp-terminal-fix` only; `make down-volumes ENV=test-mcp-terminal-fix` at the end. One Docker lock per make command (`flock .tmp/packets/DOCKER-LOCK.md ...`), never nested; never `[skip ci]`.
- Branch development happens in worktree `tmp/worktrees/mcp-terminal-response` (branch `fix/mcp-terminal-jsonrpc-response` from `origin/main`).
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/mcp-platform/src/hono.ts`
  - `packages/mcp-platform/src/tool-configuration.ts`
  - `packages/mcp-platform/tests/**`
  - `packages/mcp-platform/package.json`
  - `packages/mcp-platform/CHANGELOG.md`
  - `packages/mcp-broker/package.json` (pin floor `^0.4.1` -> `^0.4.2`, same pattern as origin/main b3a4a117c)
  - `api/src/services/mcp/registry-dispatch.ts`
  - `api/tests/api/**`
  - `BRANCH.md`
  - `package-lock.json` and `api/package-lock.json` — mechanical lockfile sync of the 0.4.2 version bump only (version-string-only diffs, same pattern as origin/main 7015f6675 / b3a4a117c)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - every other `packages/*/src/**` path; `api/src/**` except `api/src/services/mcp/registry-dispatch.ts`; `ui/**`, `e2e/**`, `apps/**`, `deploy/**` (cluster-mesh packaging fixtures are not src paths; they are conditional below under BR01-EX3)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (BR01-EX3)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (BR01-EX3)
  - `tools/memory-mcp-l5/artifacts/**` (BR01-EX5)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- BR01-EX3 (cluster-mesh packaging fixture re-pin): the mcp-platform version bump to the unpublished 0.4.2 candidate changes the `selected` fixture tuple, so `fixtures/selected/package.json` + `package-lock.json` are regenerated through make (`make ci-package-candidate` / `make pack-candidate-siblings` + `make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock ...` with the verified sibling receipts), never hand-editing integrities. Rollback: revert the two fixture files to the 0.4.1 pin. Precedent: de0e533a9 / bfbdd78df.
- BR01-EX5 (memory-l5 P1 manifest): the root lock carries the mcp-platform 0.4.2 version, so the committed P1 manifest no longer matches the live lock fingerprint and packs the mcp-platform 0.4.2 archive. Regenerate through `make memory-l5-pack STAGE=pre-candidate ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`; the previous manifest+sidecar are retained in `artifacts/history/`, one new immutable lock snapshot is added, all verify guards unchanged. Rollback: restore the retained history manifest/sidecar and delete the new snapshot. Precedent: bfbdd78df.
- api/package-lock.json: `make lock-api` does not refresh `file:` link versions, so the single `"../packages/mcp-platform"` version line is synced 0.4.1 -> 0.4.2 directly — the same targeted one-line sync #878 did as BRP0B-EX1. No dependency graph change.
- Rebase onto origin/main 3dd7d8012 (#907, sequencer-free: `reset --hard` + file checkout from the pre-rebase tip backup, lockfiles merged line-wise through make, fixture + manifest regenerated through make; the pre-rebase tip survives as `backup-mcp-terminal-fix`): BRANCH.md kept as this branch's own doc (BRLOCK-EX1 line retained, per-branch precedent); no `ci:` retrigger commits, so the final head gets exactly one pull_request run. Post-rebase gate: mcp-platform 0.4.2 > origin/main 0.4.1. Locks, cluster-mesh fixture and memory-l5 manifest are re-refreshed through make after the review fixes (the 0.4.2 candidate tgz changes with the hono.ts fix).
- PR #909 review `.h2a/reviews/pr909-large4_r1.md` (verdict CHANGES, 4 findings) — all four fixed, none rebutted:
  1. `registry-dispatch.ts`: an `authenticate` Response on the RPC path is now a terminal JSON-RPC envelope carrying the request id (code -32003, message = the stable auth error code), preserving the challenge HTTP status and `WWW-Authenticate` header; the REST /invoke passthrough is unchanged. Tests: challenge 401 + access_denied 403 on RPC, raw passthrough on REST.
  2. `hono.ts` stateless `/mcp`: `mount.createTransport()` moved inside the try, so a factory throw answers a terminal envelope with the id instead of escaping to `app.onError`. Test: factory throw.
  3. `hono.ts` `/mcp` (both modes): the request id is captured from a body clone BEFORE `handleRequest` consumes the body, so a mid-request throw answers with the real id, not `id: null`. Tests: handleRequest mocks that `await req.text()` then throw, stateful and stateless.
  4. `hono.ts` stateful `/mcp`: a single request's throw no longer closes the shared session transport (other sessions keep their streams); the envelope is that request's terminal response. The stateless per-request transport is still closed. Tests updated accordingly.

## AI Flaky tests
- Acceptance rule: no AI-flaky tests are involved; all tests here are deterministic (injected throws, in-process Hono apps).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single branch, single final test cycle)
- Rationale: one cohesive bugfix across mcp-platform + one api file plus mechanical pin sites; no parallel sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI surface change; package-level vitest lanes (`make test-mcp-platform`, `make typecheck-mcp-platform`) plus scoped api registry tests on `ENV=test-mcp-terminal-fix`.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`, `.tmp/rv/artifacts-publish-concurrency.md`.
  - [x] Create isolated worktree `tmp/worktrees/mcp-terminal-response`, branch `fix/mcp-terminal-jsonrpc-response` from `origin/main`; `harness check branch` via the Docker-built harness; `make scope-check` before every commit.
  - [x] Confirm command style: `make ... <vars> ENV=test-mcp-terminal-fix` with `ENV` last; one `flock .tmp/packets/DOCKER-LOCK.md` per make command, never nested.
  - [x] Pre-bump check: `npm view @sentropic/mcp-platform version` = 0.4.1 -> next free version 0.4.2.
- [x] **Lot 1 — Gap 1: mcp-platform hono.ts terminal responses**
  - [x] Wrap `await dispatch(...)` in `handle()` (POST /invoke, /resources/read) — REST JSON 500 `internal_error`, never hangs.
  - [x] Wrap the POST / JSON-RPC dispatch (and auth.context) — terminal `{jsonrpc:'2.0', id, error:{code:-32603}}` with the same id.
  - [x] Wrap `/mcp` stateful `await ready` and stateless `await server.connect(transport)` (+ `handleRequest`) — on throw: `transport.close()` then a JSON-RPC error envelope with the request id, so the SSE stream closes after the terminal response.
  - [x] Tests in `packages/mcp-platform/tests/hono.test.ts`: injected throws at each site produce a terminal JSON-RPC response with the same id; REST throw produces a stable JSON error; /mcp throw closes the stream (response completes, `close()` called); no internals leak in messages (9 new tests, 19 in file).
  - [x] Lot gate: `make test-mcp-platform SCOPE=tests/hono.test.ts ENV=test-mcp-terminal-fix` (19 passed), then full `make test-mcp-platform ENV=test-mcp-terminal-fix` (361 passed), `make typecheck-mcp-platform ENV=test-mcp-terminal-fix` (PASS).
- [x] **Lot 2 — Gap 2: api registry-dispatch terminal responses**
  - [x] Move `ports.authenticate`/`ports.authorize` inside the try; on the RPC path every outcome (throw, refusal, disabled, invalid) returns a JSON-RPC envelope carrying `body.id`; the catch returns `-32603` envelope on RPC, keeps 403 `artifact_request_refused` on REST /invoke.
  - [x] Tests in `api/tests/api/` (new `registry-dispatch-terminal.test.ts` + existing `app-artifacts-transport.test.ts` expectations): injected throws at transport/authenticate/authorize produce a terminal JSON-RPC response with the same id; REST /invoke unchanged apart from never hanging.
  - [x] Lot gate: scoped api lane `make test-api-unit SCOPE="tests/api/registry-dispatch-terminal.test.ts tests/api/app-artifacts-transport.test.ts tests/api/artifacts-host-credentials.test.ts" ENV=test-mcp-terminal-fix` (3 files, 46 tests passed, EXIT=0; API_TEST_WORKERS=1).
- [x] **Lot 3 — Version bump 0.4.2 + CHANGELOG + pins through make**
  - [x] `packages/mcp-platform/package.json` 0.4.2, `CHANGELOG.md` `## 0.4.2` entry, `src/tool-configuration.ts` `TOOL_CONFIGURATION_PLATFORM_VERSION = '0.4.2'`, `packages/mcp-broker/package.json` `^0.4.2`, golden digests re-pinned in `tests/tool-configuration.test.ts` (precedent 1192f5f72).
  - [x] `make lock-root ENV=test-mcp-terminal-fix` (root lock 2-line diff), `make lock-api ENV=test-mcp-terminal-fix` (no `file:` refresh) + one-line `file:` link sync per precedent.
  - [x] BR01-EX3: `make ci-package-candidate` (candidate `sentropic-mcp-platform-0.4.2.tgz`, sha256 `f9b3b3c1…`) → `make pack-mcp-platform` + `make pack-artifacts` (verified BLOCK receipts, same bytes as the published artifacts 0.2.12) → `publishable-sibling-collect` → `make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock ...` regenerated the fixture lock (integrity `sha512-vxo45FHB…` = sha512 of the candidate tgz); `fixtures/selected/package.json` dep re-pinned 0.4.2 (+ artifacts 0.2.12 from origin/main #907); `test-lazy-package` lane 135/135 passed.
  - [x] BR01-EX5: live manifest `1c740385…` (#907) archived to `artifacts/history/`, `make memory-l5-pack STAGE=pre-candidate ...` → new manifest sha256 `f0e00f5d…`, lock snapshot `223055c7…`, packs `sentropic-mcp-platform-0.4.2-c5ae5166….tgz` (memory closure unchanged by the hono.ts HTTP-surface fix, same bytes); `make memory-l5-verify` → ok (30 files, 54 edges).
  - [x] Post-bump gate: package.json 0.4.2 > npm published 0.4.1.
- [x] **Lot 4 — Final validation, PR, report**
  - [x] `make scope-check ENV=test-mcp-terminal-fix` PASS C2 before every commit; commits via `make commit MSG=...` (selective `git add`, <=150 lines, no `[skip ci]`).
  - [x] Rebase onto origin/main with union resolution; review pr909-large4_r1 findings 1-4 fixed with tests (see Feedback Loop).
  - [x] Refreshed locks/pins/manifest through make (lock-root, lock-api, BR01-EX3 fixture, BR01-EX5 manifest), then final test lanes on `ENV=test-mcp-terminal-fix` LAST: `test-mcp-platform` 363 passed, `typecheck-mcp-platform` PASS, scoped api lane 49 passed, `test-lazy-package` 135/135 passed.
  - [ ] Push branch with `--force-with-lease`, one pull_request CI on the final head; do not merge.
  - [ ] `make down-volumes ENV=test-mcp-terminal-fix` last; report to `.tmp/rv/mcp-terminal-fix-r1.md`.
