# Feature: CI seat import (L1)

## Objective
Execute lot L1 exactly as in `.tmp/ci-seats-v4/spec-v10.md` (validated by Opus challenge-opus-r6.md): import the five owner CLI seats (`agy`, `codex`, `vibe`, `muse`, `claude`) from connected CLIs (`--from cli|token`) into the sealed seat store, with the external refresh policy guard in `acquireDbAccountTransport` and the named transport paths, plus refusal tests, test-first.

## Scope / Guardrails
- Scope limited to llm-mesh CLI/token import, external refresh policy, L1-local inspect helper, API persistence/acquisition/receiver, seat delivery integration.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Never read, print or copy a real secret value. Live provider calls only per spec gates (P-BILLING receipts, Q1=A caps).
- llm-mesh release stays inside llm-gateway 0.20.0 declared range (`^0.26.0`): patch bump only (0.26.x), with a single-copy-of-mesh lock assertion (R6-1).
- h2a complements: (a) fix `completeMuseDeviceImport` mis-route (stores `transportProviderId` `muse` + `refreshToken`, then re-reads CLI login file) with a test; (b) shared refresh authority across consumers (`refreshInFlight` local, `InMemoryAccountTransportCoordinator`) checked for coverage by spec 3.4/L3 and recorded.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/SPEC_EVOL_CI_SEATS.md`
  - `packages/llm-mesh/src/enrollment/**`
  - `packages/llm-mesh/src/account-transports.ts`
  - `packages/llm-mesh/src/service/external-seat-authority.ts`
  - `packages/llm-mesh/src/service/facade.ts`
  - `packages/llm-mesh/src/service/local-account-transport-service.ts`
  - `packages/llm-mesh/src/node/index.ts`
  - `packages/llm-mesh/src/node/cli-seat-store-reader.ts`
  - `packages/llm-mesh/seat-tools/**`
  - `packages/llm-mesh/tests/**`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/README.md`
  - `package-lock.json`
  - `api/src/services/llm-account-transports.ts`
  - `api/tests/unit/llm-account-transports.test.ts`
  - `api/tests/unit/llm-seat-projection-import.test.ts`
  - `api/tests/unit/llm-seat-delivery-auth.test.ts`
  - `api/tests/api/llm-seat-delivery.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/llm-gateway/**`
  - `api/**` (except `api/src/services/llm-account-transports.ts` and the four listed test files)
  - `ui/**`
  - `e2e/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `api/src/routes/namespaces/llm-seat-delivery.ts`
  - `api/src/middleware/llm-seat-delivery-auth.ts`
  - `api/src/routes/namespaces/llm-mesh-router.ts`
  - `deploy/k8s/base/seat-delivery-mtls.yaml`
  - `deploy/k8s/base/kustomization.yaml`
  - `deploy/k8s/overlays/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `CISEAT-EX2`: status proposed. Reason: scoped sentropic-seat-delivery receiver integration (new route `api/src/routes/namespaces/llm-seat-delivery.ts`, auth `api/src/middleware/llm-seat-delivery-auth.ts`, mount in `llm-mesh-router.ts`, k8s mTLS manifests + selected overlay patch). Impact: bounded to this integration, fixed before editing. Rollback: delete the new route/middleware/manifests and revert the router mount.
- `CISEAT-EX3`: status acknowledged (reserved downstream requirement from L0a). Reason: owner-machine native Node helper (`seat-inspect`, `seat-reenroll`) needs native session keyrings (macOS Keychain, Windows Credential Manager, Linux Secret Service D-Bus). Bounds: only reviewed Make entrypoints run the bounded local store reader/inspect helper and `src/seat-reenroll.ts` natively; no host test campaign, server, second refresher or whole-home/keyring export. Rollback: disable/remove owner targets, revoke helper GitHub session, remove private runtime dir, retire disposable lab profile only.
- `R6-1`: status acknowledged. llm-gateway 0.20.0 accepts llm-mesh `^0.26.0`; L1 keeps mesh at 0.26.x (patch only) with single-copy lock assertion, or adds the named gateway bump step (not planned; gateway paths stay forbidden).

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
- Rationale: single sequential L1 integration branch; h2a consumes the published package after merge.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-<slug>`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-<slug>` after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read rules (`MASTER`, `workflow`, `subagents`, `testing`, `security`) and `README.md`.
  - [ ] Confirm worktree `tmp/worktrees/ci-seat-import` on branch `feat/ci-seat-import` from `fb5e92a6a` (L0a merged, mesh 0.26.1, SeatBundleV1).
  - [ ] Capture Makefile targets (`test-llm-mesh`, `typecheck-llm-mesh`, `lint-llm-mesh`, `up-api-test`, `test-api-unit`, `test-api-endpoints`, `typecheck-api`, `lint-api`, `test-api`, `down`, `scope-check`, `commit`, `ps-all`).
  - [ ] Define environment mapping (`ENV=test-ci-seat-import`; owner-only local inspect `ENV=dev-ci-seat-import` under CISEAT-EX3) and ports (API_PORT=9580 UI_PORT=5780 MAILDEV_UI_PORT=1680).
  - [ ] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [ ] Confirm scope and guardrails (no secret values, Q1=A caps, P-BILLING gates, R6-1 range rule).
  - [ ] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `CISEAT-EX2`/`CISEAT-EX3`/`R6-1` as above.
  - [ ] Lot gate:
    - [ ] `make typecheck-<ui/api>` + `make lint-<ui/api>`>
    - [ ] **API tests**
      - [ ] No API test changes in Lot 0.
      - [ ] Sub-lot gate: none (baseline only).
    - [ ] **UI tests (TypeScript only)**
      - [ ] N/A (no UI changes in this branch).
    - [ ] **E2E tests**
      - [ ] N/A (no browser E2E in L1; P-DEPLOY gateway restart/delivery test stays in L3).
    - [ ] non mandatory UAT if required user interaction strictly required before Lot 2, splitted by sublist for each env
      - [ ] None in Lot 0.

- [x] **Lot 1 — Package CLI/token import adapters (five CLIs)**
  - [x] Add shared source-mode/authority contract: `--from cli` registrar path (selected lab profile via provider adapter, custody transfer explicit, original lab profile retired) and `--from token` bounded stdin/FD/SDK-stream path (argv never carries the value); consumer `--from cli` parses a private provider-shaped profile + trusted manifest (parse/validate only, no exchange/mint/reread/refresh).
  - [ ] Add `packages/llm-mesh/src/enrollment/cli-seat-import.ts` (common enroll/parse entry: `h2a llm-mesh account enroll <provider> --from cli|token`).
  - [ ] Add `packages/llm-mesh/src/enrollment/agy-cli-import.ts` (agy explicit mapping: package `providerId: cloud-code`, `accountTransport: cloud-code`, adapter/client/entitlement match).
  - [ ] Extend per-provider enrollment adapters without renaming global IDs (`codex`, `mistral-vibe`, `muse`, `claude-code` unchanged): canonical registration + consumer projection parsing, no second account registry.
  - [ ] Enforce: unknown expiry is not infinite validity; reimport N idempotent, N-1/another owner fails, new epoch needs controlled replacement; registrar stable opaque seat/account mapping, no secret-derived public identifiers.
  - [ ] Lot gate:
    - [ ] `make typecheck-<ui/api>` + `make lint-<ui/api>`>
    - [ ] **API tests**
      - [ ] Existing, unchanged in this lot: `api/tests/unit/llm-account-transports.test.ts`.
      - [ ] New, none in this lot.
      - [ ] Scoped runs while evolving tests: `make test-llm-mesh SCOPE=tests/enrollment/cli-seat-import.test.ts ENV=test-ci-seat-import`.
      - [ ] Sub-lot gate: `make test-llm-mesh SCOPE=tests/enrollment/cli-seat-import.test.ts ENV=test-ci-seat-import`.
    - [ ] **UI tests (TypeScript only)**
      - [ ] N/A (no UI changes in this branch).
    - [ ] **E2E tests**
      - [ ] N/A (no browser E2E in L1).
    - [ ] non mandatory UAT if required user interaction strictly required before Lot 2, splitted by sublist for each env
      - [ ] None (synthetic only).

- [ ] **Lot 2 — Package external refresh policy + Muse/agy corrections**
  - [x] Persist and enforce external-refresh policy across token import, keyring storage, listing/reload, acquisition, explicit refresh APIs, fallback routing, application receiving store.
  - [x] Guard `local-account-transport-service.ts` (`refreshToken` + `acquire` expiry branch): on expiry an external account becomes `access-unavailable` (classified), waits for next imported projection; never erases owner claim, never derives refresh from missing token, never routes through metered key/different account/gateway.
  - [ ] Remove consumer provider-renewal and Muse key-minting paths (including after restart and 401); Muse key preparation happens in custody before import, never in mesh consumer.
  - [x] Fix (a) `completeMuseDeviceImport` mis-route: device-flow grant no longer refreshes by re-reading the CLI login file; expired device access becomes `access-unavailable` with zero CLI-store reads, covered by a dedicated test.
  - [ ] Check (b) shared refresh authority across consumers (`refreshInFlight` local map, `InMemoryAccountTransportCoordinator`): record coverage by spec 3.4/L3 (serialized-stream single temporal authority) in `.h2a/build/ci_seat_l1_report.md`.
  - [ ] Keep `cloud-code-credential-rotation.test.ts` covering external consumers refusing rotation; cloud-code fixture never qualifies native agy.
  - [ ] Lot gate:
    - [ ] `make typecheck-<ui/api>` + `make lint-<ui/api>`>
    - [ ] **API tests**
      - [ ] Existing, unchanged in this lot.
      - [ ] New, none in this lot.
      - [ ] Scoped runs while evolving tests: `make test-llm-mesh SCOPE=tests/service/external-seat-authority.test.ts ENV=test-ci-seat-import`.
      - [ ] Sub-lot gate: `make test-llm-mesh SCOPE=tests/service/external-seat-authority.test.ts ENV=test-ci-seat-import`.
    - [ ] **UI tests (TypeScript only)**
      - [ ] N/A.
    - [ ] **E2E tests**
      - [ ] N/A.
    - [ ] non mandatory UAT if required user interaction strictly required before Lot 2, splitted by sublist for each env
      - [ ] None (synthetic only).

- [x] **Lot 3 — L1-local inspect helper + node export**
  - [ ] Add `packages/llm-mesh/src/node/cli-seat-store-reader.ts` (bounded reader: explicitly selected lab record only; allowlisted schema/version/capability categories; no refresh/mint/provider call/GitHub write/transfer/activation; unsupported fields/backends return unverified/refused, never raw values).
  - [ ] Add `packages/llm-mesh/seat-tools/Makefile` (`seat-helper-setup`, `seat-inspect`; no root Makefile edit), `packages/llm-mesh/seat-tools/inspect.mjs`, `packages/llm-mesh/seat-tools/package.json`, `packages/llm-mesh/seat-tools/package-lock.json`, `packages/llm-mesh/seat-tools/node-runtime.json` (pins exact reviewed Node patch/checksum + helper deps + built mesh artifact).
  - [ ] Expose bounded reader via `packages/llm-mesh/src/node/index.ts` for L3 reuse.
  - [ ] Add `packages/llm-mesh/tests/node/cli-seat-store-reader.test.ts` (five synthetic backend adapters; selector isolation; no live-home fallback; no refresh/mint; no raw/encoded canary in stdout/stderr/errors).
  - [ ] Owner dry-run format inspection only after synthetic gates (under CISEAT-EX3, `ENV=dev-ci-seat-import`, never automated): `make seat-inspect -C packages/llm-mesh/seat-tools CLI=agy ENV=dev-ci-seat-import` (repeat `codex`, `vibe`, `muse`, `claude`).
  - [ ] Lot gate:
    - [ ] `make typecheck-<ui/api>` + `make lint-<ui/api>`>
    - [ ] **API tests**
      - [ ] Existing, unchanged in this lot.
      - [ ] New, none in this lot.
      - [ ] Scoped runs while evolving tests: `make test-llm-mesh SCOPE=tests/node/cli-seat-store-reader.test.ts ENV=test-ci-seat-import`.
      - [ ] Sub-lot gate: `make test-llm-mesh SCOPE=tests/node/cli-seat-store-reader.test.ts ENV=test-ci-seat-import`.
    - [ ] **UI tests (TypeScript only)**
      - [ ] N/A.
    - [ ] **E2E tests**
      - [ ] N/A.
    - [ ] non mandatory UAT if required user interaction strictly required before Lot 2, splitted by sublist for each env
      - [ ] Owner dry-run inspect walkthrough (manual, after gates): five CLI labels return categories only.

- [ ] **Lot 4 — API persistence/acquisition guard + agy mapping + billed-fallback disable**
  - [ ] Update `api/src/services/llm-account-transports.ts`: external/access-only store variants for `storeAntigravityAccountTransport` (keep antigravity/cloudcode-pa/productAccountSource=antigravity) and `storeClaudeCodeAccountTransport`; parse/reload external variant in `parseClaudeCodeTokenSecret` without erasing policy or reclassifying as mesh-managed renewable; no refresh material or dummy token in consumer projections.
  - [ ] Guard `acquireDbAccountTransport:2164` before `refreshTokenIfNeeded` at `:2378` (policy read ahead of hook): external accounts skip every per-transport hook (`refreshAntigravityTokenIfNeeded:2094/:2100/:2104`, `refreshClaudeCodeTokenIfNeeded:1811/:1821`, `refreshCodexTokenIfNeeded:1748/:1758`, `refreshMuseTokenIfNeeded:1908`/`readMuseCliEntry:1927`, `refreshMistralVibeTokenIfNeeded:543`); valid unexpired access returns directly, expiry/401 classifies `access-unavailable`, retains `token_secret`/owner/lineage/policy, releases reservation, awaits next projection; policy also guards explicit refresh and outcome/401 paths; no missing-token branch erases an external account. `refreshCloudCodeTokenIfNeeded:1964/:1974` stays the forbidden cloud-code/gemini route for agy (never its guard).
  - [ ] Bypass `importAntigravityEnrollment` (`provider-connections.ts:1521`) in the new projection receiver: validate trusted access-only projection, invoke external store variant directly with exact agy tuple, zero discovery/refresh/mint side effect.
  - [ ] Disable C1 D3.3 billed-key fallback for these accounts (expiry, 401, delivery failure, exhausted seat quota never select a configured billed key).
  - [ ] Update `api/tests/unit/llm-account-transports.test.ts` (positive agy + Claude Code fixtures with no refresh token at all; import/persist/parse-reload/acquire valid unexpired access via `acquireAntigravityAccountTransport`, `acquireClaudeCodeAccountTransport`, `acquireOpenAICodexAccountTransport`, `acquireMuseAccountTransport` through the real guard; valid/expired/401/explicit-refresh cases; zero `refreshAntigravityAccessToken`/`readMuseCliEntry`/import-hook/renewal/mint/billed-fallback; `token_secret` + owner/lineage/policy preserved; newer-projection recovery; Vibe non-destructive regression).
  - [ ] Add `api/tests/unit/llm-seat-projection-import.test.ts` (agy package cloud-code to application antigravity/cloudcode-pa + productAccountSource; refuse gemini target, application cloud-code transport, mixed tuples, wrong clients with zero DB mutation/acquisition/provider calls and zero `importAntigravityEnrollment`; refuse refresh-bearing projections and live use lacking trusted billing clearance).
  - [ ] Start isolated API stack first: `make up-api-test API_PORT=9580 UI_PORT=5780 MAILDEV_UI_PORT=1680 ENV=test-ci-seat-import`.
  - [ ] Lot gate:
    - [ ] `make typecheck-<ui/api>` + `make lint-<ui/api>`>
    - [ ] **API tests**
      - [ ] Existing + updated: `api/tests/unit/llm-account-transports.test.ts`.
      - [ ] New: `api/tests/unit/llm-seat-projection-import.test.ts`.
      - [ ] Scoped runs while evolving tests: `make test-api-unit SCOPE=tests/unit/llm-account-transports.test.ts API_PORT=9580 UI_PORT=5780 MAILDEV_UI_PORT=1680 ENV=test-ci-seat-import`.
      - [ ] Scoped runs while evolving tests: `make test-api-unit SCOPE=tests/unit/llm-seat-projection-import.test.ts API_PORT=9580 UI_PORT=5780 MAILDEV_UI_PORT=1680 ENV=test-ci-seat-import`.
      - [ ] Sub-lot gate: both scoped runs above.
    - [ ] **UI tests (TypeScript only)**
      - [ ] N/A.
    - [ ] **E2E tests**
      - [ ] N/A.
    - [ ] non mandatory UAT if required user interaction strictly required before Lot 2, splitted by sublist for each env
      - [ ] None (synthetic API only).

- [ ] **Lot 5 — Seat-delivery receiver (conditional CISEAT-EX2)**
  - [ ] Declare `CISEAT-EX2` before editing conditional paths (exact overlay files, rationale, impact, rollback).
  - [ ] Add `api/src/routes/namespaces/llm-seat-delivery.ts` + `api/src/middleware/llm-seat-delivery-auth.ts`; mount in `api/src/routes/namespaces/llm-mesh-router.ts` (existing mount edit only).
  - [ ] Add `deploy/k8s/base/seat-delivery-mtls.yaml` + `deploy/k8s/base/kustomization.yaml` + selected target overlay patch only (P-DEPLOY resolves target; no infra changes beyond selection).
  - [ ] Implement: scoped identity, wrong-owner refusal, forged-header/direct-access refusal, drain/ack/reload, monotonic import/ack, seat drain/reopen, zero billed-key fallback.
  - [ ] Add `api/tests/unit/llm-seat-delivery-auth.test.ts` + `api/tests/api/llm-seat-delivery.test.ts`.
  - [ ] Lot gate:
    - [ ] `make typecheck-<ui/api>` + `make lint-<ui/api>`>
    - [ ] **API tests**
      - [ ] Existing, unchanged in this lot (except receiver mount).
      - [ ] New: `api/tests/unit/llm-seat-delivery-auth.test.ts`, `api/tests/api/llm-seat-delivery.test.ts`.
      - [ ] Scoped runs while evolving tests: `make test-api-unit SCOPE=tests/unit/llm-seat-delivery-auth.test.ts API_PORT=9580 UI_PORT=5780 MAILDEV_UI_PORT=1680 ENV=test-ci-seat-import`.
      - [ ] Scoped runs while evolving tests: `make test-api-endpoints SCOPE=tests/api/llm-seat-delivery.test.ts API_PORT=9580 UI_PORT=5780 MAILDEV_UI_PORT=1680 ENV=test-ci-seat-import`.
      - [ ] Sub-lot gate: both scoped runs above.
    - [ ] **UI tests (TypeScript only)**
      - [ ] N/A.
    - [ ] **E2E tests**
      - [ ] N/A (L3 owns `tests/e2e/seat-persistent-delivery.test.ts` with real TLS/revocation on a non-production target).
    - [ ] non mandatory UAT if required user interaction strictly required before Lot 2, splitted by sublist for each env
      - [ ] Synthetic delivery walkthrough: import projection both modes, see one account; expire, see classified unavailable with zero refresh; deliver N+1, see recovery without duplication; wrong-owner and older-generation refusal.

- [ ] **Lot 6 — Mesh version, lock assertion, spec sync**
  - [ ] Bump `packages/llm-mesh/package.json` patch only (stay 0.26.x inside gateway `^0.26.0`); refresh `package-lock.json` (required mesh metadata only, no unrelated regeneration); assert exactly one llm-mesh copy in the custody harness lock.
  - [ ] Update existing package tests for all five adapters + authority/delivery (`contracts`, `codex`, `cloud-code`, `cloud-code-credential-rotation`, `claude-code`, `mistral-vibe`, `muse`, `facade`, `local-account-transport-service`, `local-account-transport-service-claude`, `local-account-transport-service-muse`) and retain/extend `seat-bundle.test.ts` (no duplicate creation).
  - [ ] Add `packages/llm-mesh/tests/enrollment/cli-seat-import.test.ts`, `packages/llm-mesh/tests/enrollment/agy-cli-import.test.ts`, `packages/llm-mesh/tests/service/external-seat-authority.test.ts`, `packages/llm-mesh/tests/service/seat-projection-delivery.test.ts`.
  - [ ] Sync `spec/SPEC_EVOL_CI_SEATS.md` (L1 interfaces, supported/unverified table deltas, gates) and `packages/llm-mesh/README.md`.
  - [ ] Lot gate:
    - [ ] `make typecheck-<ui/api>` + `make lint-<ui/api>`>
    - [ ] **API tests**
      - [ ] Existing + updated: `api/tests/unit/llm-account-transports.test.ts`.
      - [ ] New: `api/tests/unit/llm-seat-projection-import.test.ts`, `api/tests/unit/llm-seat-delivery-auth.test.ts`, `api/tests/api/llm-seat-delivery.test.ts`.
      - [ ] Scoped runs while evolving tests: per-file `make test-api-unit` / `make test-api-endpoints` runs with `API_PORT=9580 UI_PORT=5780 MAILDEV_UI_PORT=1680 ENV=test-ci-seat-import`.
      - [ ] Sub-lot gate: `make test-api API_PORT=9580 UI_PORT=5780 MAILDEV_UI_PORT=1680 ENV=test-ci-seat-import`.
    - [ ] **UI tests (TypeScript only)**
      - [ ] N/A.
    - [ ] **E2E tests**
      - [ ] N/A.
    - [ ] non mandatory UAT if required user interaction strictly required before Lot 2, splitted by sublist for each env
      - [ ] None (packaging only).

- [ ] **Lot N-2** UAT
  - [ ] Web app (splitted by sublist for each env)
    - [ ] Synthetic projection import through both modes shows one account (no live seat needed).
    - [ ] Expired projection shows classified unavailable state with zero refresh calls.
    - [ ] N+1 delivery recovers without account duplication.
    - [ ] Wrong-owner and older-generation imports are refused.
    - [ ] Per qualified live lab seat (only with P-BILLING receipt + Q1 quota): both imports through the trusted helper.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Refactor and integrate `spec/BRANCH_SPEC_EVOL.md` into existing specs (if not a new standalone spec).
  - [ ] Delete `spec/BRANCH_SPEC_EVOL.md` after integration.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest UI (cf Lot1, copy checklist)
  - [ ] Retest API (cf Lot1, copy checklist)
  - [ ] Retest e2e (cf lots e2e_groups like in Lot1)
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
