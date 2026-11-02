# Feature: RC2 re-pin r3 (RC2.store + RC2.registry)

## Objective
Move the RC2.store and RC2.registry pins from RC2.contract r2 (MANIFEST 133e23f5…) to r3 (MANIFEST 6245d3ae…), applying only the r3 delta: N1 chat dialect for the store (pins/fixtures/vectors only, no code change while retainedPayload is null) and the N4 hashes for the registry. Source-gaps stay fail-closed with no local fill.

## Scope / Guardrails
- Scope limited to the r3 re-pin of the two merged lots (store #874 a861fbd3e, registry #873 5e8a08b96): `BRANCH.md` contract pins plus the registry re-pin label in `packages/cluster-mesh/tests/remote-session/registry.spec.ts`. No production code, no schema/vector bytes live in this repo.
- Make-only workflow, no direct Docker commands; the single Docker lock `.tmp/packets/DOCKER-LOCK.md` is taken PER COMMAND via `flock`.
- Branch development happens in isolated worktree `tmp/worktrees/rc2-repin-r3` (branch `feat/rc2-repin-r3` from `origin/main` d1f45c625).
- Automated test campaigns run on `ENV=test-rc2-repin` only, always LAST; never `ENV=dev`; `make down ENV=test-rc2-repin` after; reuse the existing pinned Node image, no new image build; never `make clean-all`.
- All new text in English. No `[skip ci]` in any commit message. One CI run per final head. Push often (crash safety). Secrets by NAME from `.env` only.
- Contract pins (binding, r3, all under /home/antoinefa/src/h2a/tmp/h-cond/rc2-contract/): MANIFEST.sha256 seal sha256 6245d3ae51f601195926bc36600d1097cef30694f3feb01f79f1a7ec9fa17715 (`sha256sum -c MANIFEST.sha256` 303/303 OK, verified before use); manifest JSON remote-session-contract-manifest.v1.json sha256 88823475eca151d908450e4abadcac7b2b60d4b5ea16bae0f590d419fa394565; RC2-CONTRACT.md sha256 4a7fc1615148f64f0af168a3d01fb7881d479f6d464b532c9bd78cc0d2d08b89; CHANGES-r3.md sha256 04cbf4ad38cdac9417c6c17148736852036bc5636e3f8acc47c5190727448456; RC2-R2-SEMANTICS.md sha256 6786e52e78d1e6afc9f06755e610a609e3ca77c5d1fb249feeb2f977b84f8331; changes-r3.json sha256 fa2007c2e742c381c031bfc8b608557defa0650409d88451ed58f797b9d78843. Unchanged inputs: plan v1.6 draft sha256 6168b73ba9b236530bde6bb4998929de1ede0c92d61aa0fc07fcd4f9983b7b18; RC0 draft.6 rev b 87908afecb9d389cebd324a87717313e2f86f885200322cd55d52930962aee48.
- Lineage only, NOT acceptance: r2 MANIFEST 133e23f54d7268c104fe45be753d2ea28b402b8621beefab95ed35062d84318e (manifest JSON f7e4a148…, contract cc8965c9…); r1 MANIFEST dfb2589969f78cf040e8b3f0857cd933722aff5ad5445553ac42b7ba583abbed. Neither the r1 ACK nor the r2 pins transfer to r3; r3 requires a new receiving ACK from the Muse 1.3 app boundary. CONTRACT PARTIAL stays.
- r3 delta scope (CHANGES-r3.md / changes-r3.json, verified entry by entry): N1 `tool_call_delta` remote field args→delta in schemas/SessionChatPayloadV1.schema.json plus the 4 chat vectors (store re-verifies only; `retainedPayload` stays null so no code change is expected); N2 policy-confirm/bodyless-route http metadata (receiver scope, not this lot); N3 provenance labels only; N4 the four registry-adjacent schema `$comment` fixes, verified `/$comment`-only in changes-r3.json. `changes-r3.json.methods` is empty (no port change).
- Sentropic-pinned vectors verified unchanged r2→r3: listing digest 226ad2fed8143a5c9f5549fb3ae2cbd5e42ae13af67ca6c1957bb9233233fe98 present identically in r2-baseline.json and r3 vectors/registry-revision-digests.json; vectors/r2-semantics.json `retentionDeadline` byte-equal between r2 baseline and r3.
- Source-gaps stay fail-closed (refuse), never invented: DEP-FED (H2-I/F1/F2/F15), DEP-AUTH-B/M0, DEP-AUTH-A/A2.0b, SG-R15, N1/N4/N5 packed exports, DEP-RESIDENCE/RCP.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.
- Re-verify the contract manifest hash before each push.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/tests/remote-session/registry.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - all production code (`api/src/**`, `packages/*/src/**`, `ui/src/**`, `e2e/**`)
  - lockfiles (`package-lock.json`, `api/package-lock.json`, `ui/package-lock.json`, `apps/**/package-lock.json`)
  - `.github/workflows/**`
  - `.track/**`, `.tmp/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none used by this branch
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `acknowledge`: r3 manifest verified before use — `sha256sum -c MANIFEST.sha256` 303/303 OK, self-digest 6245d3ae…, manifest JSON 88823475… match the conductor pins; every r3 manifest entry checked.
- [x] `acknowledge`: N4 verified `/$comment`-only for schemas/SessionFreshnessAttestationV1, SessionLifecycleBatchV1, SessionListingProjectionV1, SessionRegistrySnapshotV1 in changes-r3.json; N1 is the single args→delta rename in the tool_call_delta variant (tool_call_start keeps args); methods empty; 14 routes changed are receiver-scope only.
- [x] `acknowledge`: store N1 impact — no code change while `retainedPayload` is null (api/src/services/cluster-mesh/session-content-policy-store.ts); pins/labels only. Registry N4 impact — hash-only; this repo pins no schema bytes, so only the re-pin label moves.
- [x] `acknowledge`: sentropic-pinned digest 226ad2fe… and retentionDeadline vector are byte-identical r2→r3, so no test expectation changes beyond the re-pin label.

## AI Flaky tests
- [x] No AI-dependent tests in scope.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one small re-pin lot on a single branch; no sub-workstreams; one final test cycle and one CI run.

## UAT Management (in orchestration context)
- **Mono-branch**: no UAT — no UI or API behavior change; test-campaign gates only.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, .tmp/packets/COMMON-RULES.md, plan/BRANCH_TEMPLATE.md.
  - [x] Create isolated worktree `tmp/worktrees/rc2-repin-r3`, branch `feat/rc2-repin-r3` from `origin/main` d1f45c625; `harness check branch` PASS C1; `.env` copied from root.
  - [x] Verify every r3 manifest entry before use (303/303 OK) and the two conductor pins.
  - [x] Write `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
  - [x] Environment mapping: `ENV=test-rc2-repin` always LAST; ports `API_PORT=8822 UI_PORT=5208 MAILDEV_UI_PORT=1102` (verified free on host).
  - [x] Confirm scope boundaries; no `BRxx-EXn` exception needed.
- [ ] **Lot 1 — r3 re-pin (store + registry)**
  - [x] Update `packages/cluster-mesh/tests/remote-session/registry.spec.ts` re-pin describe label to r3 / manifest 6245d3ae.
  - [x] Record r3 contract pins in `BRANCH.md` (this file).
  - [x] Lot gate (all under `flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`, one command at a time, `ENV=test-rc2-repin` LAST, existing api image reused via `API_VERSION=b5a304`, no image build):
    - [x] store: `make test-api-endpoints SCOPE=tests/api/session-content-receiver.test.ts API_PORT=8822 UI_PORT=5208 MAILDEV_UI_PORT=1102 ENV=test-rc2-repin` — 17/17 passed
    - [x] store: `make test-api-unit SCOPE=tests/unit/remote-action-audit.test.ts API_PORT=8822 UI_PORT=5208 MAILDEV_UI_PORT=1102 ENV=test-rc2-repin` — 11/11 passed
    - [x] registry: `make test-cluster-mesh SCOPE=tests/remote-session/registry.spec.ts API_PORT=8822 UI_PORT=5208 MAILDEV_UI_PORT=1102 ENV=test-rc2-repin` — 57/57 passed, no type errors (r3 re-pin describe incl. digest vector 226ad2fe…)
    - [x] registry api: `make test-api-endpoints SCOPE=tests/api/session-remote-view.test.ts API_PORT=8822 UI_PORT=5208 MAILDEV_UI_PORT=1102 ENV=test-rc2-repin` — 2/2 passed
    - [x] registry ui: `make test-ui SCOPE=tests/session-content/navigation.test.ts API_PORT=8822 UI_PORT=5208 MAILDEV_UI_PORT=1102 ENV=test-rc2-repin` — 4/4 passed
    - [x] `make down API_PORT=8822 UI_PORT=5208 MAILDEV_UI_PORT=1102 ENV=test-rc2-repin` — all test-rc2-repin containers removed
    - [x] `harness check scope` PASS C2 and `make scope-check` PASS C2
    - [x] `make commit MSG="..."`; push `feat/rc2-repin-r3`; open READY PR with BRANCH.md as body; run one CI; report to `.tmp/rv/rc2-repin-r3.md`.
