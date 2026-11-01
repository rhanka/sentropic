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
- **Exception process**:
  - BR03a-EX1 declared here before touching `Makefile`: reason = r6 §7.3 requires every §6.4 destination wired into its owning required Make suite (`test-security-daily`, already run by required CI job `validate-ci-capacity-metrics`); impact = additive SCOPE entries only, no existing entry removed; rollback = revert the single SCOPE line.
  - BR03a-EX2 declared here before touching the version files: reason = rules/workflow.md Post-Rebase Gate + `enforce-package-bump` CI job after the #681 rebase; impact = version string only in `packages/llm-mesh/package.json` and its workspace entry in `package-lock.json`; rollback = revert to `0.32.2`.
  - BR03a-EX3 declared here before touching the cluster-mesh fixtures: reason = r6 §6.1 post-rebase package-version gate (EX2) makes `packages/llm-mesh` the unpublished candidate `0.32.3`, and the cluster-mesh train/selected fixtures pin the workspace tuple exactly (main precedent: commit d1e9d31fd rebound them to `0.32.2`); impact = version literals plus the single `@sentropic/llm-mesh` lock entry (version/resolved/sibling sha512) only, no spec logic changed; rollback = revert the three files to the `0.32.2` pins.

## Feedback Loop
- `BR01-EX1`: touch `api/drizzle/control/0014_*.sql` + `api/drizzle/control/meta/_journal.json` (one migration for policy admission/cursor/outbox/purge tables; reason: durable store needs new tables; impact: control schema +1 migration; rollback: drop tables, revert journal entry).
- `BR01-EX2`: touch `packages/cluster-mesh/package.json` (version bump only; reason: CI enforce-package-bump requires bump when `packages/<pkg>/src/**` changes; impact: version field only; rollback: revert version line).
- 2026-11-01 resume: rebased onto `origin/main` (`a67778379`); re-pinned r2 contract hashes (§Scope); fixed never-green test bugs with evidence (wrong `../../../src` depth, vacuous `toMatchObject` on throwing fns, non-hex `'t'.repeat(64)`, missing receipt before `refreshCapture`, amend missing repeated deadline). Implementation unchanged — it already enforced the contract.

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
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md` and `rules/workflow.md`
  - [ ] Create/confirm isolated worktree `tmp/worktrees/rc2-store` on `origin/main` (`455813bf923e9a58f701b17d2adbef01b2df0e71`)
  - [ ] Capture Makefile targets needed for debug/testing.
  - [ ] Define environment mapping (`dev`, `test`, `e2e`) and ports for this branch.
  - [ ] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [ ] Confirm scope and guardrails.
  - [ ] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.
  - [ ] Ports: `API_PORT=8802 UI_PORT=5188 MAILDEV_UI_PORT=1095 ENV=test-rc2-store`
- [ ] **Lot 1 — Tests first (red)**
  - [x] Add `api/tests/api/session-content-receiver.test.ts` (STORE: F2-01 proposal/proof/activation, F2-02 post-ACK boundary, F2-05 retention/purge, denial races, immutable deadlines)
  - [x] Add `api/tests/unit/remote-action-audit.test.ts` (STORE-ERASURE: audit/payload/backup separation, writer-settled purge)
  - [ ] Run red campaign scoped under flock: `flock .tmp/packets/DOCKER-LOCK.md make test-api-endpoints SCOPE=tests/api/session-content-receiver.test.ts API_PORT=8802 UI_PORT=5188 MAILDEV_UI_PORT=1095 ENV=test-rc2-store`
  - [ ] Run red unit scope: `flock .tmp/packets/DOCKER-LOCK.md make test-api-unit SCOPE=tests/unit/remote-action-audit.test.ts API_PORT=8802 UI_PORT=5188 MAILDEV_UI_PORT=1095 ENV=test-rc2-store`
  - [ ] Lot gate:
    - [ ] `make typecheck-api` + `make lint-api` API_PORT=8802 UI_PORT=5188 MAILDEV_UI_PORT=1095 ENV=test-rc2-store
    - [ ] **API tests**
      - [ ] New `api/tests/api/session-content-receiver.test.ts` (STORE)
      - [ ] Scoped run while evolving: `make test-api-endpoints SCOPE=tests/api/session-content-receiver.test.ts API_PORT=8802 UI_PORT=5188 MAILDEV_UI_PORT=1095 ENV=test-rc2-store`
      - [ ] Sub-lot gate: `make test-api-unit SCOPE=tests/unit/remote-action-audit.test.ts API_PORT=8802 UI_PORT=5188 MAILDEV_UI_PORT=1095 ENV=test-rc2-store`
    - [ ] **UI tests (TypeScript only)**
      - [ ] No UI changes in this lot; no UI test updates.
      - [ ] Sub-lot gate: not applicable (no UI scope)
    - [ ] **E2E tests**
      - [ ] No E2E changes in this lot; no E2E updates.
- [ ] **Lot 2 — Store implementation (green)**
  - [x] Add `packages/cluster-mesh/src/sessions/content-policy.ts` (channels, retention, policy digest domain, fail-closed gates)
  - [x] Add `api/src/services/cluster-mesh/session-content-policy-store.ts` (admission CAS, activation ACK/receipt, capture reconnect grant, cursor/outbox, writer-settled purge)
  - [x] Extend `api/src/db/control-schema.ts` (policy admission/cursor/outbox/purge tables)
  - [x] Add `api/drizzle/control/0014_*.sql` + journal entry (`BR01-EX1`)
  - [x] Bump `packages/cluster-mesh/package.json` patch (`BR01-EX2`)
  - [x] Lot gate (2026-11-01, all green on rebased head):
    - [x] `make typecheck-api` + `make lint-api` API_PORT=8802 UI_PORT=5188 MAILDEV_UI_PORT=1095 ENV=test-rc2-store (tsc clean; eslint 0 errors, no warnings in branch files)
    - [x] **API tests**
      - [x] Updated `api/tests/api/session-content-receiver.test.ts` (STORE green 9/9)
      - [x] Updated `api/tests/unit/remote-action-audit.test.ts` (STORE-ERASURE green 4/4)
      - [x] Scoped runs while evolving (same commands as Lot 1)
      - [x] Sub-lot gate: full `make test-api-unit API_PORT=8802 UI_PORT=5188 MAILDEV_UI_PORT=1095 ENV=test-rc2-store` (150 files, 1558 passed, 2 skipped)
    - [ ] **UI tests (TypeScript only)**
      - [ ] No UI changes; no updates.
    - [ ] **E2E tests**
      - [ ] No E2E changes; no updates.
- [ ] **Lot N-1 — Docs consolidation**
  - [ ] No `spec/BRANCH_SPEC_EVOL.md` created (single-slice branch, no spec evolution file).
- [ ] **Lot N — Final validation**
  - [x] Typecheck & Lint
  - [x] Retest UI (not applicable, no UI scope)
  - [x] Retest API (scoped STORE + STORE-ERASURE + unit suite)
  - [x] Retest e2e (not applicable, no e2e scope)
  - [x] Retest AI flaky tests (not applicable, no AI scope)
  - [x] Bumped `packages/cluster-mesh/package.json` version (semver) — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Delivery stops at draft PR + one green CI + `.tmp/rv/rc2-store.md` report; no merge (per packet).
