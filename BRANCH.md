# Feature: RC2.store content-policy store and purge

## Objective
- Implement RC2.store scoped on the frozen RC2 contract: identity-backed content-policy admission, retained-read cursor, outbox and writer-settled purge, fail-closed on source-gaps.

## Scope / Guardrails
- Scope limited to content-policy domain, store service, one control migration, two acceptance specs.
- One migration max in `api/drizzle/control/*.sql`.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/rc2-store` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Contract pins (r2 freeze, verified 2026-11-01): plan v1.6 `6168b73ba9b236530bde6bb4998929de1ede0c92d61aa0fc07fcd4f9983b7b18`, MANIFEST.sha256 `133e23f54d7268c104fe45be753d2ea28b402b8621beefab95ed35062d84318e`, RC2-CONTRACT.md `cc8965c9affad415c35261d1909489ab12a4db15b33296a9e1dba8b6952544d0`, manifest JSON `f7e4a148aef4db2732d770b723751e9f8f9fb6a2dffcfdaac12913498915a23a`, RC0 draft.6 rev b `87908afecb9d389cebd324a87717313e2f86f885200322cd55d52930962aee48` (manifest `rc0Sha256`/`planSha256` match; r1 seal `dfb2589969f78cf040e8b3f0857cd933722aff5ad5445553ac42b7ba583abbed` preserved as `priorAcceptance`, not r2 acceptance).
- Re-verify manifest seal hash before each push; mismatch blocks the push.
- Source-gaps (R15 unaccepted, real identity tuple, durable store writer) stay fail-closed: refuse, never invent.
- No FED input required for this lot.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/src/sessions/content-policy.ts`
  - `api/src/services/cluster-mesh/session-content-policy-store.ts`
  - `api/src/db/control-schema.ts`
  - `api/tests/api/session-content-receiver.test.ts`
  - `api/tests/unit/remote-action-audit.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `api/**`
  - `packages/**` (except the Conditional files below)
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/control/0014_*.sql` (max 1 file)
  - `api/drizzle/control/meta/_journal.json`
  - `packages/cluster-mesh/package.json`
  - `BRANCH.md` (this branch file)
  - `package-lock.json` (BR01-EX3)
  - `api/package-lock.json` (BR01-EX3)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (BR01-EX4)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (BR01-EX4)
- **Exception process**:
  - BR03a-EX1 declared here before touching `Makefile`: reason = r6 §7.3 requires every §6.4 destination wired into its owning required Make suite (`test-security-daily`, already run by required CI job `validate-ci-capacity-metrics`); impact = additive SCOPE entries only, no existing entry removed; rollback = revert the single SCOPE line.
  - BR03a-EX2 declared here before touching the version files: reason = rules/workflow.md Post-Rebase Gate + `enforce-package-bump` CI job after the #681 rebase; impact = version string only in `packages/llm-mesh/package.json` and its workspace entry in `package-lock.json`; rollback = revert to `0.32.2`.
  - BR03a-EX3 declared here before touching the cluster-mesh fixtures: reason = r6 §6.1 post-rebase package-version gate (EX2) makes `packages/llm-mesh` the unpublished candidate `0.32.3`, and the cluster-mesh train/selected fixtures pin the workspace tuple exactly (main precedent: commit d1e9d31fd rebound them to `0.32.2`); impact = version literals plus the single `@sentropic/llm-mesh` lock entry (version/resolved/sibling sha512) only, no spec logic changed; rollback = revert the three files to the `0.32.2` pins.

## Feedback Loop
- `BR01-EX1`: touch `api/drizzle/control/0014_*.sql` + `api/drizzle/control/meta/_journal.json` (one migration for policy admission/cursor/outbox/purge tables; reason: durable store needs new tables; impact: control schema +1 migration; rollback: drop tables, revert journal entry).
- `BR01-EX2`: touch `packages/cluster-mesh/package.json` (version bump only; reason: CI enforce-package-bump requires bump when `packages/<pkg>/src/**` changes; impact: version field only; rollback: revert version line).
- 2026-11-01 resume: rebased onto `origin/main` (`a67778379`); re-pinned r2 contract hashes (§Scope); fixed never-green test bugs with evidence (wrong `../../../src` depth, vacuous `toMatchObject` on throwing fns, non-hex `'t'.repeat(64)`, missing receipt before `refreshCapture`, amend missing repeated deadline). Implementation unchanged — it already enforced the contract.
- 2026-11-01 r2 re-pin adjustment (only the r2 deltas that touch RC2.store, per CHANGES-r2.md): W-P3-3/annex E — retention now uses the frozen ContentPolicyV1 shape `{kind:'finite',durationMs}` with the 315576000000 ms ten-Julian-year product cap (`TEN_JULIAN_YEAR_MS`), `{kind:'none'}` = no expiry (not disabled storage), and `computeRetentionDeadline` implements vectors/r2-semantics.json `retentionDeadline` exactly (none→null, finite→firstAdmissionAt+durationMs, over-cap and unsafe-sum refuse); the store validates the first-admission deadline as null-or-safe-integer and keeps it immutable across amend/refresh/read. W-P2-4/annex E — `ownerConsentRevision` zero is unobserved/invalid, so admission refuses `< 1` (`revision_conflict`). ContentPolicy* schemas/vectors are byte-identical r1→r2 (changes-r2.json), so no other store change was needed; W-P1-3 chat dialect is RC3.chat scope (this store keeps `retainedPayload: null`, no payload bytes). MANIFEST.sha256 `133e23f5…` re-verified (`sha256sum -c` all OK) before push.
- 2026-11-01 lane note: test ports overridden to `API_PORT=8812 UI_PORT=5198 MAILDEV_UI_PORT=1096` because 8802/1095 were already bound by another lane's compose project; `ENV=test-rc2-store` still last.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.
- `BR01-EX3`: touch `package-lock.json` + `api/package-lock.json` (1 line each: `packages/cluster-mesh` / `../packages/cluster-mesh` version sync to `0.26.0-dev.4`; reason: CI `changes` gate requires train package versions to match the lockfiles after the `BR01-EX2` bump; impact: single version string per file; rollback: revert the line).
- `BR01-EX4`: touch `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` + `package-lock.json` (pin `sentropic-cluster-mesh-0.26.0-dev.4.tgz` in the fixture deps and lock entry; reason: CI `validate-cluster-mesh` `prepare-artifacts.spec.ts` requires the selected fixture to track the candidate release tuple after the `BR01-EX2` bump, same pattern as `origin/main` dev.3; impact: 4 pin strings, no test logic; rollback: revert pins to `0.26.0-dev.3`).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: <Single store slice with one migration and two specs; no orthogonal sub-workstreams>

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
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md` and `rules/workflow.md`
  - [x] Create/confirm isolated worktree `tmp/worktrees/rc2-store` on `origin/main` (`a67778379` after rebase)
  - [x] Capture Makefile targets needed for debug/testing.
  - [x] Define environment mapping (`dev`, `test`, `e2e`) and ports for this branch.
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.
  - [x] Ports: `API_PORT=8812 UI_PORT=5198 MAILDEV_UI_PORT=1096 ENV=test-rc2-store` (8802/1095 were bound by another lane; see Feedback Loop)
- [x] **Lot 1 — Tests first (red)**
  - [x] Add `api/tests/api/session-content-receiver.test.ts` (STORE: F2-01 proposal/proof/activation, F2-02 post-ACK boundary, F2-05 retention/purge, denial races, immutable deadlines)
  - [x] Add `api/tests/unit/remote-action-audit.test.ts` (STORE-ERASURE: audit/payload/backup separation, writer-settled purge)
  - [x] Run red campaign scoped under flock: `flock .tmp/packets/DOCKER-LOCK.md make test-api-endpoints SCOPE=tests/api/session-content-receiver.test.ts API_PORT=8812 UI_PORT=5198 MAILDEV_UI_PORT=1096 ENV=test-rc2-store`
  - [x] Run red unit scope: `flock .tmp/packets/DOCKER-LOCK.md make test-api-unit SCOPE=tests/unit/remote-action-audit.test.ts API_PORT=8812 UI_PORT=5198 MAILDEV_UI_PORT=1096 ENV=test-rc2-store`
  - [x] Lot gate (2026-11-01 r2 re-pin head, all green):
    - [x] `make typecheck-api` + `make lint-api` API_PORT=8812 UI_PORT=5198 MAILDEV_UI_PORT=1096 ENV=test-rc2-store (tsc clean; eslint clean)
    - [x] **API tests**
      - [x] `api/tests/api/session-content-receiver.test.ts` (STORE green 11/11 incl. r2 finite-deadline and consent-fence cases)
      - [x] Scoped run while evolving: `make test-api-endpoints SCOPE=tests/api/session-content-receiver.test.ts ... ENV=test-rc2-store`
      - [x] Sub-lot gate: `make test-api-unit SCOPE=tests/unit/remote-action-audit.test.ts ... ENV=test-rc2-store` (STORE-ERASURE green 9/9 incl. retentionDeadline vector cases)
    - [x] **UI tests (TypeScript only)**
      - [x] No UI changes in this lot; no UI test updates.
      - [x] Sub-lot gate: not applicable (no UI scope)
    - [x] **E2E tests**
      - [x] No E2E changes in this lot; no E2E updates.
- [ ] **Lot 2 — Store implementation (green)**
  - [x] Add `packages/cluster-mesh/src/sessions/content-policy.ts` (channels, retention, policy digest domain, fail-closed gates)
  - [x] Add `api/src/services/cluster-mesh/session-content-policy-store.ts` (admission CAS, activation ACK/receipt, capture reconnect grant, cursor/outbox, writer-settled purge)
  - [x] Extend `api/src/db/control-schema.ts` (policy admission/cursor/outbox/purge tables)
  - [x] Add `api/drizzle/control/0014_*.sql` + journal entry (`BR01-EX1`)
  - [x] Bump `packages/cluster-mesh/package.json` patch (`BR01-EX2`)
  - [x] Lot gate (2026-11-01 r2 re-pin head, all green):
    - [x] `make typecheck-api` + `make lint-api` API_PORT=8812 UI_PORT=5198 MAILDEV_UI_PORT=1096 ENV=test-rc2-store (tsc clean; eslint clean)
    - [x] **API tests**
      - [x] Updated `api/tests/api/session-content-receiver.test.ts` (STORE green 11/11)
      - [x] Updated `api/tests/unit/remote-action-audit.test.ts` (STORE-ERASURE green 9/9)
      - [x] Scoped runs while evolving (same commands as Lot 1)
      - [x] Sub-lot gate: full `make test-api-unit API_PORT=8812 UI_PORT=5198 MAILDEV_UI_PORT=1096 ENV=test-rc2-store` (150 files, 1563 passed, 2 skipped); `make down ... ENV=test-rc2-store` after
    - [x] **UI tests (TypeScript only)**
      - [x] No UI changes; no updates.
    - [x] **E2E tests**
      - [x] No E2E changes; no updates.
- [x] **Lot N-1 — Docs consolidation**
  - [x] No `spec/BRANCH_SPEC_EVOL.md` created (single-slice branch, no spec evolution file).
- [ ] **Lot N — Final validation**
  - [x] Typecheck & Lint
  - [x] Retest UI (not applicable, no UI scope)
  - [x] Retest API (scoped STORE + STORE-ERASURE + unit suite)
  - [x] Retest e2e (not applicable, no e2e scope)
  - [x] Retest AI flaky tests (not applicable, no AI scope)
  - [x] Bumped `packages/cluster-mesh/package.json` version (semver) — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [x] Final gate step 1: PR #874 (draft) exists; body refreshed from this `BRANCH.md`.
  - [ ] Final gate step 2: run/verify branch CI on that PR (one run on the final head) and resolve remaining blockers.
  - [ ] Delivery stops at draft PR + one CI + `.tmp/rv/rc2-store.md` report; no merge (per packet).
