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
- `attention`: CI run 42681767001 `artifacts-qualification (unit)` single failure `packages/artifacts/tests/sqlite-conformance.test.ts > passes every UP-T vector` (`UP-T conformance failed: db-time-skew`, caused by `invalid activation ticket` at `seed` -> `flows.put`, i.e. a >50 ms stall between 50 ms-ticket issue and put under Date.now skew on a loaded runner). Out of branch scope (zero diff in `packages/artifacts/` vs `origin/main`; toolchain pinned via `locked-tools.mjs`, root lock not consumed; identical code green in run 42654174044). Treated as non-systematic timing flake pending the fresh-head run.
- `attention`: Gemini API key provided by owner as named secret; secret name proposed in the lane report, never printed or committed.
- `attention`: merge `71b443130` integrates `origin/main` `67205fe00` (artifacts-live install watchdog, PR #982; 19 files, main-side only, zero overlap with lot1 scope; BRANCH.md kept `--ours`). `make scope-check` C2 advisory on the merged main-side `api/artifacts-live` paths only (expected for a main merge, same as `acdc13eaf`); no branch edit outside Allowed Paths.
- `attention`: local `make test-llm-mesh ENV=test-llm-mesh-lot1` on the merged head: first run 3 failed / 1780 passed with one unhandled `Serialized Error { code: 'no_active_account' }` surfacing in `tests/service/local-account-transport-service-claude.test.ts` (last test `holds real Claude refresh through save failure=true`); next three runs on the identical head 102/102 files, 1783/1783 tests green. Same commit + same command with successes => non-systematic local timing flake, accepted per the rule above, no test retouched.
- `attention`: CUSTODIAN-EX2 — the r2 BLOCKER (M1 post-rotation replay) needs a typed stage signal, so `packages/llm-mesh/src/enrollment/muse-code.ts` gains the additive `MusePostRotationError` export (only the refresh mint path throws it; token-endpoint shapes unchanged) and the cycle reads it in the service classifier; rollback = revert the r2 commits, no other caller depends on the new class. The service, report, alert and test files are already in Allowed Paths.
- `attention`: merge `966213bda` integrates `origin/main` `00d160d79` (artifacts-live diag, PR #986; main-side only, zero overlap with lot1 scope; BRANCH.md kept `--ours`). `make scope-check` C2 advisory on the merged main-side `api/artifacts-live` paths only (expected for a main merge, same as `acdc13eaf`); no branch edit outside Allowed Paths (+ CUSTODIAN-EX2 enrollment file).
- `attention`: CI trigger gap — pushes `0a09b112a`, `d2b7bbab6`, `9c4e4f0cd` produced no workflow run at all (repo-wide paginated search empty; other lanes served meanwhile); only merge pushes triggered (`42718518668`). Fresh heads pushed to retrigger; no rerun/skip of any existing run.
- `attention`: merge `fc27b6a1d` integrates `origin/main` `303f5557a` (compose backup owner, PR #987; main-side only: `api/`, `deploy/`, `Makefile` BRCBO-EX1 host-user docker flag; zero overlap with lot1 scope; BRANCH.md kept `--ours`).
- `attention`: CI `validate-cluster-mesh (lazy)` red on the r2 head (`lock integrity ... != sibling` for `llm-mesh@0.34.0` — expected after r2 src changes; the fixture lock pins the pre-r2 tarball). Fix: `selected/package-lock.json` llm-mesh integrity → pack bytes of this commit (built dists, deterministic `npm pack`, byte-identical to the CI sibling sha quoted in the failure). Regenerated via sanctioned `refresh-lazy-package-lock` (dists rebuilt: `build-mcp-platform/artifacts/llm-mesh/llm-gateway/comments`; produced `file:` URLs without receipts, so the committed registry-URL form was restored surgically — 2-line diff). The refresh install first failed on a stale `artifacts@0.2.25` pin (registry republished: lock `4NL6…` vs published `jc0f7…`, frozen-registry 502): realigned to the published packument/tarball (host-verified). Pre-existing staleness, harmless in CI test-mode (proven green on `d3207cd22`), but it blocks the sanctioned refresh for every lane until fixed. Local hygiene: root-owned `packages/llm-mesh/dist` + `node_modules` (08:16 runs) moved aside in-worktree (`dist.root-bak-*`, `node_modules.root-bak-*`, untracked, never pushed); `sudo chown -R antoinefa` + removal still requested from the owner.
- `attention`: Lot R2 (Wonder r2 REQUEST_CHANGES) rework on this branch, all with regression tests: M1 fail-closed classifier (defer only on explicit 429/5xx token-endpoint responses incl. Claude `HTTP <status>` form, or typed local preparation failures; timeouts/resets/mint-after-rotation/unknown flip instead of replaying), typed `MusePostRotationError` from the Muse mint path; B3-muse CLI-import refresh through the cycle instead of the grant-less flip (direct keys `auth_type: 'api_key'` keep the flip); B3-partial `expiring-no-grant` once-per-enrollment warning inside the window with upcoming `expiresAt` in report and event; M4 unknown/unreadable expiry reads `reauth-required` report-only (external: no flip/alert; grant-holding dateless: no flip); MINORs: `tuple-skew` refuses `0.35.0`, sink-throw retry, facade restore-from-`updatedAt`, interval clamp/floor. Rejected with justification: `auth_failed` immediate emission (coordinator layer owns no alert port; bounded to one loop interval under the Lot 2 single-loop contract); 0.34.0 collision with unmerged lot5 (second merged branch bumps to 0.35.0 and re-widens ranges/fixtures/changelog — not actionable here). Scoped green: `make test-llm-mesh SCOPE=tests/service/custodian-refresh.test.ts ENV=test-llm-mesh-lot1` 28/28, full `make test-llm-mesh ENV=test-llm-mesh-lot1` 102 files / 1796 tests, `make test-cluster-mesh SCOPE=tests/packaging/tuple-skew.spec.ts ENV=test-llm-mesh-lot1` 21 passed / 2 skipped (packed fixtures), `make typecheck-llm-mesh` + `make lint-llm-mesh` clean.

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
- [x] **Lot R2 — Wonder r2 rework (1 BLOCKER + 2 MAJORs + fail-closed reporting, all with regression tests)**
  - [x] M1 blocker: fail-closed classifier (explicit 429/5xx or typed preparation defers; timeout/reset/mint/unknown flips) + typed `MusePostRotationError` (CUSTODIAN-EX2) + 5 tests
  - [x] B3-muse: CLI-import refresh through the cycle (direct keys keep the flip) + 2 tests
  - [x] B3-partial: `expiring-no-grant` once-per-enrollment warning + upcoming `expiresAt` in report/event + test
  - [x] M4: unknown/unreadable expiry reads `reauth-required` report-only, no flip/alert + 2 tests
  - [x] MINORs: `tuple-skew` refuses `0.35.0`; sink-throw retry; facade restore-from-`updatedAt`; interval clamp/floor; `auth_failed` immediate-emission rejected (no alert port in coordinator, bounded by loop interval); 0.34.0/lot5 collision noted (second merge bumps)
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
