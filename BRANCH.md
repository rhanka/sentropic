# Feature: llm-mesh Lot 1 custodian refresh

## Objective
Mesh-managed custodian with proactive refresh before expiry, per-account custody-state report and reauth alert (live per-account probe is the preprod GO item, Lot 2 scope).

## Scope / Guardrails
- Scope limited to `packages/llm-mesh/src`, `packages/llm-mesh/tests`, `packages/llm-mesh/package.json`.
- No migration in `api/drizzle/*.sql`.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/llm-mesh-lot1`.
- Automated test campaigns run on dedicated environment (`ENV=test-llm-mesh-lot1`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `package-lock.json`
  - `packages/llm-mesh/src/service/local-account-transport-service.ts`
  - `packages/llm-mesh/tests/decision-public-surface.test.ts`
  - `packages/llm-mesh/CHANGELOG.md`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `packages/cluster-mesh/tests/fixtures/train.ts`
  - `packages/llm-mesh/src/service/facade.ts`
  - `packages/llm-mesh/src/service/custodian-refresh.ts`
  - `packages/llm-mesh/src/service/reauth-alert.ts`
  - `packages/llm-mesh/tests/service/custodian-refresh.test.ts`
  - `packages/llm-mesh/tests/service/custodian-refresh-policy.test.ts`
  - `packages/llm-mesh/tests/service/facade.test.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-gateway/package.json`
  - `api/tests/unit/gateway-package-version.test.ts`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/tests/fixtures/train.ts`
  - `packages/cluster-mesh/tests/modules/registry.spec.ts`
  - `packages/cluster-mesh/tests/modules/topology-ranges.spec.ts`
  - `packages/cluster-mesh/tests/packaging/optional-install.spec.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.spec.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.ts`
  - `packages/cluster-mesh/tests/packaging/tuple-skew.spec.ts`
  - `packages/cluster-mesh/tests/speech-peer.spec.ts`
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
- `attention`: D1 owner decision 09/11 custodian in cluster (llm-mesh holds and maintains ALL owner accounts, permanently; immo is a device with no account/keyring/import).
- `attention`: D2 accepted for the owner tenant only; kill-switch cross-user stays OFF for any other use.
- `attention`: D3 Gemini-only fallback (gemini-3.8-flash) is Lot 5 scope, not this branch; this branch only keeps the static-key class and budget admission points untouched.
- `acknowledge`: D4 alert is emitted here via `ReauthAlertSink` (status flip + secret-free event, once per epoch); host wiring (h2a forward + owner re-auth gate + loop start, exactly one loop per owner scope) is Lot 2 scope — this branch stays library-only by design (M5).
- `attention`: CUSTODIAN-EX1 — the M6 minor bump widens llm-mesh consumer ranges (`llm-gateway`, `cluster-mesh` peer + catalog + pinned specs/train/fixtures, `cluster-mesh` dev bump per precedent `3b9626d35`/`c9f19941f`) plus the `llm-gateway` 0.22.4 → 0.22.5 patch the package-candidates bumpGate requires on published manifests with changed dependency maps (precedent `143392cea`; api version-evidence test follows the bump); rollback = revert the bump commits, no src behavior depends on the version strings.
- `attention`: bump follow-through per repo convention (3b9626d35, d4c503eb0): hardcoded version in `decision-public-surface.test.ts`, `CHANGELOG.md` entry, and `selected` fixture lock regen via `refresh-lazy-package-lock`; ranges already cover 0.33.1 (gateway `^0.33.0`, cluster-mesh `<0.34.0`), no range edit.
- `attention`: CI run 42635384823 e2e shard 1 single failure `tests/07-matrix.spec.ts:477` (Matrix lock/presence, User A leaves lock release, 9.9s, `toBe` Object.is). Out of branch scope (no UI/API change; llm-mesh additions are inert without `startCustodianLoop` wiring, Lot 2). Main push run 42625546540 is green on the same spec. Treated as non-systematic UI flake pending the fresh-head rerun.
- `attention`: Gemini API key provided by owner as named secret; secret name proposed in the lane report, never printed or committed.

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
- Rationale: single package scope, one lane, one CI.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/llm-mesh-lot1`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/sentropic`, `ENV=dev`).
  - Switch back to `tmp/worktrees/llm-mesh-lot1` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `.tmp/packets/COMMON-RULES.md`, `.tmp/rv/llm-mesh-accounts-plan.md`.
  - [x] Create isolated worktree `tmp/worktrees/llm-mesh-lot1` on branch `feat/llm-mesh-lot1-custodian-refresh` from `origin/main` (verified via `git branch --show-current`).
  - [x] Verify plan reuse lines on current `main` (facade moved to `service/facade.ts`; cloud-code refresh, codex device+refresh, Claude PKCE+refresh+import, Vibe fail-closed, Muse direct-key no-rotation, encrypted keyring confirmed).
  - [x] Confirm environment mapping: `ENV=test-llm-mesh-lot1`, `API_PORT=8911`, `UI_PORT=5311`, `MAILDEV_UI_PORT=1211`.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare exceptions if needed (none needed).
- [x] **Lot 1 — Custodian mesh-managed, proactive refresh, reauth alert**
  - [x] Add `ReauthAlertSink` port (`reauth-alert.ts`): owner-scoped event, diagnostic account ref only, first-transition emission.
  - [x] Add custodian refresh cycle (`custodian-refresh.ts`): skew policy (25 percent TTL remaining or 10 min), injected clock, per-account report.
  - [x] Wire cycle + sink into `LocalAccountTransportService` (skip external seats, reuse single-flight, flip `reauth_required` early).
  - [x] Expose cycle, loop start/stop and sink options via `createLlmMeshFacade`.
  - [x] Vibe/Muse re-enrollment path unchanged (fail-closed refresh kept, diagnostic points at re-enrollment).
  - [x] Lot gate:
    - [x] `make typecheck` + `make lint` for impacted components
    - [x] **API tests**
      - [x] Add `packages/llm-mesh/tests/service/custodian-refresh.test.ts` (refresh before expiry under injected clock; refresh failure yields reauth diagnostic with no business call; two same-transport accounts coexist with owner isolation).
      - [x] Scoped runs while evolving: `make test-api SCOPE=packages/llm-mesh/tests/service/custodian-refresh.test.ts ENV=test-llm-mesh-lot1`
      - [x] Sub-lot gate: existing `packages/llm-mesh/tests/service/*` + `packages/llm-mesh/tests/service/facade.test.ts` stay green
      - [ ] AI flaky tests run (non-blocking only under acceptance rule) and document status/signature in `BRANCH.md`
    - [x] **UI tests (TypeScript)**
      - [x] None (no UI change).
    - [x] **E2E tests**
      - [x] None (no user-facing flow change; live preprod probe is a GO item run by the conductor with owner enrollment).
    - [ ] non mandatory UAT if required user interaction strictly required before Lot 2, splitted by sublist for each env
      - [ ] Preprod probe GO: owner interactive enrollment done + 1 generation per enrolled transport green (conductor-owned).
- [x] **Lot R — Wonder review rework (BLOCKERs + MAJORs, all with regression tests)**
  - [x] B1 issuance-based TTL (no refresh-every-tick) + policy/cycle tests
  - [x] B2 epoch cleared on (re-)enrollment + re-alert test
  - [x] B3 grant-less expiry flips + alerts; expired external reads reauth-required + tests
  - [x] M1 error classification (defer transient, flip definitive) + 3 tests
  - [x] M2 jitter + single-loop-per-owner contract in loop/facade docs
  - [x] M3 onError + immediate tick + interval validation; persist-fail still alerts (acquire-path test); refresh-in-flight report; route flip stays cycle-reported
  - [x] M4 readiness aligned with route directory (expired external); live network probe stays preprod GO (no probe method on EnrollmentProvider, quota rule)
  - [x] M5 D4 label corrected (sink here, host wiring Lot 2); facade option-wiring tests; loop is host-started, single per owner scope
  - [x] M6 minor bump 0.34.0 + consumer range/fixture alignment per CUSTODIAN-EX1
  - [x] MINORs: policy sanitize + test; full injected clock (no wall-time in custody decisions); custodian controls on admin facade; Allowed Paths list the policy test; CHANGELOG describes custody-state report (no probe overclaim); diagnostic ref stays report-only (no lookup use)
- [ ] **Lot N-1 — Docs consolidation**
  - [ ] No spec consolidation needed (no `spec/BRANCH_SPEC_EVOL.md` created).
- [ ] **Lot N — Final validation**
  - [x] Typecheck & Lint
  - [x] Retest API (cf Lot 1, copy checklist)
  - [x] Retest UI (none, no UI change)
  - [x] Retest e2e (none, no E2E change)
  - [x] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [x] Bumped `packages/llm-mesh/package.json` version (patch) — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [x] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
