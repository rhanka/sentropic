# Feature: mcp-scope-qualification

## Objective
Qualify mcp-auth for Immo application scopes with a minimal guarded source fix (`BR01-EX1`: missing scopes now return the documented `403 insufficient_scope` instead of `401 invalid_token`).

## Scope / Guardrails
- Scope limited to 3-qualification Sentropic side only.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/mcp-scope-qualification` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/mcp-auth/tests/application-scopes.test.ts`
  - `packages/mcp-auth/tests/core.test.ts`
  - `packages/mcp-auth/tests/hono.test.ts`
  - `packages/mcp-auth/tests/prm.test.ts`
  - `api/tests/api/mcp-resource-server.test.ts` (only under `BR01-EX2`)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/**` except `api/tests/api/mcp-resource-server.test.ts` (see `BR01-EX2`)
  - `packages/auth-hono/**`
  - `packages/mcp-platform/**`
  - `packages/cluster-mesh/**`
  - `api/src/routes/namespaces/oauth-ingress.ts`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/mcp-auth/src/**` (only if a test proves a defect)
  - `packages/mcp-auth/package.json` (version bump only if a source fix ships)
  - `packages/mcp-auth/CHANGELOG.md` (only under `BR01-EX1`)
  - `package-lock.json` (only under `BR01-EX1`)
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `attention`: Radar PRM mount/ingress fix is i-cond owned, out of scope here. This branch therefore delivers the 3-qualification lot only PARTIALLY (Sentropic side via PR #675); the Radar half is `not covered` and stays with i-cond, so the lot cannot be declared complete on this PR alone.
- `BR01-EX1`: touch `packages/mcp-auth/src/core.ts` + bump `packages/mcp-auth/package.json` to `0.2.2` + refresh `package-lock.json`.
- `BR01-EX1` reason: real-token tests prove missing scopes return `401` instead of the documented `403`.
- `BR01-EX1` impact: one-line fix, patch bump, admitted by all consumer ranges. Observable contract change: a valid token missing the operation scope now returns `403 insufficient_scope` (RFC 6750 §3.1) where `0.2.1` returned `401 invalid_token`; documented in `packages/mcp-auth/CHANGELOG.md` under `0.2.2`. Radar baseline `sans immo:read → 401` becomes `403` once Radar consumes `0.2.x`; baseline update handed to i-cond.
- `BR01-EX1` rollback: revert the three files, restore `0.2.1`, rerun `make test-mcp-auth`.
- `BR01-EX2`: update one assertion in `api/tests/api/mcp-resource-server.test.ts` (`401` to `403`).
- `BR01-EX2` reason: CI proves the test encoded the fixed bug; intent (reject before Google) is unchanged.
- `BR01-EX2` impact: one assertion in a forbidden-path test file, no source change.
- `BR01-EX2` rollback: revert the line, rerun the scoped API suite.
- `decided` (review `.h2a/reviews/immo_3q_opus.md`): F1 closed by `df80b5a93` (explicit `McpAuthError`/`invalid_token` assertions); F2 closed by `6faaec040` (single-scope grants + cross-scope `403`s, table sourced from spec-v2 §2 / Radar fixture `4dc37c8`); F3 closed by `43d94d769` (four Radar-baseline refusal cases); F9 closed by `f1287ff3f` (same-kid foreign-key signature check); F6 closed by `f1c3855e4` (Hono guard with real signed token) + `99c470841` (double-mounted PRM); F4 closed herein (CHANGELOG observable-change note, `BR01-EX1` impact, UAT 2b, baseline handoff to i-cond); F5 closed herein; F7 recorded as partial above (Radar half `not covered`, i-cond owned); F8 held (all fix commits ≤68 lines).
- `attention` (R2-2): the per-tool grant test passes `requiredScopes` manually to mcp-auth; compiled per-capability policy belongs to 3-policy/4a and is not delivered here.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- Record: `e2e/tests/09-chat-org-update-tool.spec.ts:49` (`Chat organization_update tool › updates the organization technologies field on request (default model)`, AI-flaky allowlist) failed once in CI job `test-e2e (group-d, 08 09)`, run `38833573638` attempt 1 (job `116759969101`), commit `90831b41a`. Command: `make test-e2e ENV=e2e-ci`. Signature: `expect(after).not.toBe(before)` at line 167 → `Expected: not "Legacy mainframe"` after 2.1 min polling; trace `technologies before="Legacy mainframe" after="Legacy mainframe" toolCallObserved=false`; model did not call `organization_update` in the 120 s window; no mcp-auth code path involved. Non-systematic: same commit and same command green at run `38833573638` attempt 2 (job `116766881777`); also green on `1db814905` (run `38836550713`) and on head `cba46c559` (run `38844992840`, job `116795604719`). `flaky accepted` per non-systematic rule. Explicit user sign-off still required before any merge: pending.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single test-only slice with one minimal guarded source fix; all work lands on this branch, so one integrated test cycle suffices.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-<slug>`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/sentropic`, `ENV=dev`).
  - Switch back to `tmp/feat-<slug>` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `rules/security.md` and `README.md`.
  - [x] Confirmed isolated worktree `tmp/worktrees/mcp-scope-qualification` on branch `fix/mcp-scope-qualification`, baseline `origin/main`.
  - [x] Captured targets: `make typecheck-mcp-auth`, `make test-mcp-auth`, `make pack-mcp-auth`, `make lock-root`, `make scope-check`.
  - [x] Environment mapping: `ENV=test-mcp-scope-qualification`, `API_PORT=9565`, `UI_PORT=5765`, `MAILDEV_UI_PORT=1665`.
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Confirm scope and guardrails: Sentropic-side 3-qualification only, Radar PRM/ingress is i-cond owned.
  - [x] Validate scope boundaries and declare `BR01-EX1` before touching conditional paths.
  - [x] No `spec/BRANCH_SPEC_EVOL.md`: single-lot qualification branch, not complex.

- [ ] **Lot 1 — 3-qualification mcp-auth scope tests**
  - [x] Add `packages/mcp-auth/tests/application-scopes.test.ts` with real signed Immo-only tokens (acceptance half green)
  - [x] Update `packages/mcp-auth/tests/core.test.ts` with unit pin (R2-1: `verifyAccessToken` never receives `requiredScopes`)
  - [x] Updated `packages/mcp-auth/tests/hono.test.ts` with real-token guard (F6, R2-5 error-class fix)
  - [x] Updated `packages/mcp-auth/tests/prm.test.ts` with double-mount proof (F6)
  - [x] Fix `packages/mcp-auth/src/core.ts` under `BR01-EX1` (test proved the defect) + bump to `0.2.2` + relock
  - [x] Lot gate:
    - [x] `make typecheck-mcp-auth ENV=test-mcp-scope-qualification`
    - [x] **API tests**
      - [x] Existing: `packages/mcp-auth/tests/core.test.ts`
      - [x] Existing: `packages/mcp-auth/tests/hono.test.ts`
      - [x] Existing: `packages/mcp-auth/tests/prm.test.ts`
      - [x] Existing: `packages/mcp-auth/tests/scopes.test.ts`
      - [x] Existing: `packages/mcp-auth/tests/challenge.test.ts`
      - [x] Existing: `packages/mcp-auth/tests/service-auth.test.ts`
      - [x] Existing: `packages/mcp-auth/tests/package-manifest.test.ts`
      - [x] New: `packages/mcp-auth/tests/application-scopes.test.ts`
      - [x] Scoped runs while evolving tests: `make test-mcp-auth SCOPE=tests/application-scopes.test.ts ENV=test-mcp-scope-qualification`
      - [x] Sub-lot gate: `make test-mcp-auth ENV=test-mcp-scope-qualification`
      - [x] AI flaky tests run (non-blocking only under acceptance rule): see record in `## AI Flaky tests`
    - [x] **UI tests (TypeScript only)**
      - [x] None: pure library slice, no UI change
      - [x] Sub-lot gate: `make test-ui ENV=test` skipped, no UI surface
    - [x] **E2E tests**
      - [x] None: pure library slice, no browser surface
      - [x] Sub-lot gate: skipped, no E2E surface
    - [ ] UAT hosted-client continuity owned by i-cond post-merge (after `0.2.2` publication and 2b, not a merge gate)
      - [ ] Immo-only grants pass existing ingress and tool requirements without generic `mcp:*` scopes
      - [ ] Three scopes appear in PRM metadata surface when configured (AS surface owned by 2-IdP; both verified with real client in global UAT)
      - [ ] Wrong issuer/audience and missing actual scope fail
      - [ ] Claimed scope in tool arguments has no authority
      - [ ] UAT 2b (F4): hosted client presenting a valid token without `immo:read` receives `403 insufficient_scope` and handles it as step-up/insufficient-scope without reconnection (no re-authorization loop; reaction expected, unverified until i-cond runs 2b)

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
  - [x] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [x] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once CI is `OK` + AI-flaky sign-off recorded, commit removal of `BRANCH.md`, push, and merge (hosted-client UAT incl. 2b is post-merge i-cond, not a merge gate).
