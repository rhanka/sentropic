# Feature: RC2.receiver — frozen source routes and source/browser/relay middleware separation

## Objective
Implement lot RC2.receiver of the approved remote-control plan v1.6 r2 (plan SHA-256 6168b73b…, lot row line 646): the exact frozen source routes under `/api/v1/auth/session/content` and `/api/v1/auth/session/remote`, plus the machine relay mount at `/mesh/v1/session-relay` and the inner virtual mount `/mesh/v1/remote-sessions/:sessionId`, with strict source/browser/relay middleware separation on the real RC1 approvedTarget and endpoint authority, per RC2.contract **r3** (pinned from the first commit): MANIFEST.sha256 `6245d3ae51f601195926bc36600d1097cef30694f3feb01f79f1a7ec9fa17715`, manifest JSON sha256 `88823475eca151d908450e4abadcac7b2b60d4b5ea16bae0f590d419fa394565` (replaces r2 `133e23f5…`; r3 delta in CHANGES-r3.md: N1 tool_call_delta args→delta, N2 policy-confirm bodyless plus the zero-entity-bytes rule on the 14 bodyless/query routes, N3/N4 labels only), all under `/home/antoinefa/src/h2a/tmp/h-cond/rc2-contract/`. Every source-gap stays fail-closed; no source-gap field is filled locally; the h2a native side is faked in tests only. A re-pin is required when a later contract revision lands.

## Scope / Guardrails
- Scope limited to the API receiver surface: new `api/src/routes/session-content/**`, mounts in `api/src/app.ts`, tests in `api/tests/api/session-content-receiver.test.ts`.
- Reuses merged RC2.store #874 (a861fbd3e) and RC2.registry #873 (5e8a08b96) exports only; does not duplicate or modify them (no `packages/**` changes, no package version bump needed).
- Make-only workflow, no direct Docker commands; single Docker lock `.tmp/packets/DOCKER-LOCK.md` taken PER COMMAND via `flock`.
- Root workspace reserved for user dev/UAT (`ENV=dev`) and untouched; all work in worktree `tmp/worktrees/rc2-receiver`.
- Automated tests run on `ENV=test-rc2-receiver` only, `ENV` always LAST, `make down ENV=test-rc2-receiver` after.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English. No secrets read, printed, logged or committed. No `[skip ci]`. Commits via `make commit MSG="..."` only, ≤150 lines, selective staging.
- Branch: `feat/rc2-receiver` from `origin/main` (d1f45c625; prerequisites RC2.store #874 a861fbd3e and RC2.registry #873 5e8a08b96 are ancestors), worktree `tmp/worktrees/rc2-receiver`. Ports: `API_PORT=8793 UI_PORT=5193 MAILDEV_UI_PORT=1093`, `ENV=test-rc2-receiver`.
- Contract pins (binding, r3, under `/home/antoinefa/src/h2a/tmp/h-cond/rc2-contract/`): MANIFEST.sha256 `6245d3ae51f601195926bc36600d1097cef30694f3feb01f79f1a7ec9fa17715`; remote-session-contract-manifest.v1.json `88823475eca151d908450e4abadcac7b2b60d4b5ea16bae0f590d419fa394565`; CHANGES-r3.md `04cbf4ad38cdac9417c6c17148736852036bc5636e3f8acc47c5190727448456`; plan v1.6 draft `6168b73ba9b236530bde6bb4998929de1ede0c92d61aa0fc07fcd4f9983b7b18`. Re-verify `sha256sum -c MANIFEST.sha256` before each push.
- r3 consumer scope for this lot (CHANGES-r3.md "Consumer re-pin"): all 38 route http entries — in particular the 14 bodyless/query routes (action-stream, browser-detail, browser-events, browser-list, browser-listing-delete, drive-binding-fetch, grant-fetch, history-admission, history-auth, listing-grant-fetch, policy-confirm, policy-fetch, relay-upgrade, source-control) with their vectors/route-*.json hashes; policy-confirm maxRequestBytes 65536→0 with the annex-D family mapping (invalid_request / view_refused / relay_protocol_refused). N1 chat dialect files are store/RC3.chat scope, not this lot.
- h2a ACK conditions: every source-gap stays fail-closed; no source-gap field is filled locally; a re-pin is required when a later contract revision lands.
- Acceptance (plan lot row 646 + vectors 789–790 + closures W04/W06 979–981): before-body owner/source/scope/key rejection; atomic ACK and gaps; wrong-lane refusal; upgrade isolation (machine mount rejects cookies/Origin, wrong audience/protocol, stale/foreign/replayed tunnel before upgrade or body allocation; browser mount rejects source-only credentials); relay mount at `/mesh/v1/session-relay`. Cases RECEIVER / CHAIN-MOUNT / CHAIN-LANE in `api/tests/api/session-content-receiver.test.ts`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/routes/session-content/**`
  - `api/src/app.ts`
  - `api/tests/api/session-content-receiver.test.ts`
  - `BRANCH.md`
  - `packages/cluster-mesh/src/identity-contracts/**`
  - `packages/cluster-mesh/src/storage/identity/**`
  - `packages/cluster-mesh/src/identity-stores/**`
  - `packages/cluster-mesh/src/identity/**`
  - `packages/cluster-mesh/tests/identity/**`
  - `packages/cluster-mesh/tests/identity-*.spec.ts`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/CHANGELOG.md`
  - `package-lock.json` (BR-A20B-EX3)
  - `api/package-lock.json` (BR-A20B-EX3)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (BR-A20B-EX3)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (BR-A20B-EX3)
  - `packages/cluster-mesh/tests/packaging/identity-auth-types.spec.ts` (BR-A20B-EX4)
  - `packages/cluster-mesh/tests/storage/postgres.mk` (BR-A20B-EX1)
  - `packages/cluster-mesh/tests/storage/cold-workspace.sh` (BR-A20B-EX2)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/**` (RC2.store/RC2.registry reused as-is; no package edits, no version bump)
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
  - `ui/**`, `e2e/**`, `apps/**`, `spec/**`
  - `api/src/services/**`, `api/src/db/**`, `api/src/middleware/**` (existing services reused read-only)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `packages/cluster-mesh/tests/storage/postgres.mk` (BR-A20B-EX1)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- (none open)

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
- Rationale: single lot RC2.receiver, one branch, one scoped test file; no sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this lot; API-only acceptance via `api/tests/api/session-content-receiver.test.ts` (RECEIVER / CHAIN-MOUNT / CHAIN-LANE).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/rc2-receiver`.
  - Push branch before UAT.
  - No user UAT required (no UI surface); API witnesses only.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`, plan v1.6 r2 (lot row 646, vectors 789–790, closures 979–981), RC2.contract r2 (MANIFEST 133e23f5…).
  - [x] Create/confirm isolated worktree `tmp/worktrees/rc2-receiver` on `feat/rc2-receiver` from `origin/main` (5e8a08b96); `harness check branch` PASS.
  - [x] Capture Make targets: `up-api-test`, `test-api-endpoints SCOPE=…`, `typecheck-api`, `lint-api`, `down`.
  - [x] Environment mapping: `ENV=test-rc2-receiver`, `API_PORT=8793 UI_PORT=5193 MAILDEV_UI_PORT=1093`.
  - [x] Command style: `flock .tmp/packets/DOCKER-LOCK.md make … ENV=test-rc2-receiver` with `ENV` last.
  - [x] Scope boundaries declared above; no exceptions needed.
- [ ] **Lot 1 — Tests first: RECEIVER / CHAIN-MOUNT / CHAIN-LANE**
  - [x] Extend `api/tests/api/session-content-receiver.test.ts` with `describe` blocks RECEIVER, CHAIN-MOUNT, CHAIN-LANE (existing STORE block untouched).
  - [ ] RECEIVER: before-body owner/source/scope/key rejection on frozen source routes; atomic ACK commit + gap reporting; idempotent replay; conflict refusal.
  - [ ] CHAIN-LANE: content-only grant refused on actions/results lanes before handler/body; mismatched lane on inner mount refused; stage subset enforcement.
  - [ ] CHAIN-MOUNT: relay mount at `/mesh/v1/session-relay` rejects cookies/Origin, wrong audience, wrong subprotocol, stale/foreign/replayed tunnel before 101 or body allocation; browser mount rejects source-only credentials; inner mount refuses without bound socket.
  - [ ] Lot gate:
    - [ ] `make typecheck-api … ENV=test-rc2-receiver`
    - [ ] `make lint-api … ENV=test-rc2-receiver`
    - [ ] `make test-api-endpoints SCOPE=tests/api/session-content-receiver.test.ts … ENV=test-rc2-receiver`
    - [ ] `make down ENV=test-rc2-receiver`
- [ ] **Lot 2 — Implementation**
  - [ ] `api/src/routes/session-content/**`: frozen route table, source/browser/relay middleware, routers, fail-closed product ports (real RC1 approvedTarget port type; capsule header pin and H2-I/DEP-FED slots null → fail-closed).
  - [ ] Mounts in `api/src/app.ts`: `/api/v1/auth/session/content`, `/api/v1/auth/session/remote`, `/mesh/v1/session-relay`, `/mesh/v1/remote-sessions`.
  - [ ] Re-run Lot 1 gates green; `make scope-check` before each commit.
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & lint API.
  - [ ] Scoped receiver suite green on `ENV=test-rc2-receiver`; `make down ENV=test-rc2-receiver`.
  - [ ] Atomic commits ≤150 lines via `make commit`; push `feat/rc2-receiver` (crash safety: push after each commit batch).
  - [ ] Open READY (non-draft) PR with BRANCH.md text as body; run ONE CI on the final head; record result.
  - [ ] Report to `.tmp/rv/rc2-receiver.md` (PR, head, CI, each acceptance item). Do not merge.
