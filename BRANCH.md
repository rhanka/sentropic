# Feature: G1 — three-mode sharing access model in @sentropic/artifacts

## Objective
Implement sharing lot G1 of the binding convergence `.tmp/concertation-share/converged-r2.md` (sha256 1d5723e4…) §2.1/§2.2 and the G1 row of §7, with owner answers (`.tmp/concertation-share/owner-answers.md`): default share is view-only, a separate collab (source) right grantable to exactly one named colleague and never platform-wide/public (schema-enforced), paused shares resume automatically and show as paused, a share covers all retained versions. Existing MCP tool definitions stay byte-identical (new fields/tools only, never edits).

## Scope / Guardrails
- Scope limited to `packages/artifacts/**` (src, tests, migrations) plus this `BRANCH.md`.
- One migration max: `packages/artifacts/migrations/0006_sharing.sql` (additive only).
- Make-only workflow, no direct Docker commands; Docker under `flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md` taken PER COMMAND.
- Tests on `ENV=test-share-g1` (always LAST argument), never `ENV=dev`; `make down ENV=test-share-g1` after every test stack.
- No `[skip ci]` in any commit; CI budget: one run on the final head.
- All new text in English. No human-effort or time estimates.
- Crash safety: push `feat/share-g1-access-model` to origin after every few commits.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/src/**`
  - `packages/artifacts/tests/**`
  - `packages/artifacts/migrations/0006_sharing.sql`
  - `packages/artifacts/package.json` (version bump only)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`, `rules/**`
  - `api/**`, `ui/**`, `e2e/**`, `apps/**`, `deploy/**`
  - `packages/**` other than `packages/artifacts/**`
  - `src/**` (root app sources)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none declared; any need becomes a `BRxx-EXn` in `## Feedback Loop` first.
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- (empty — no blockers at branch start)

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- G1 touches no AI-generation path; no AI flaky tests expected.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single lot G1 in one package; one branch, one worktree `tmp/worktrees/share-g1`, one test env `test-share-g1`.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- G1 is package-internal (no UI surface); UAT = package test suites + CI. No browser UAT for this lot.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/share-g1`.
  - Push branch before CI.
  - No root-workspace UAT needed for G1 (no app surface changed).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `.tmp/packets/COMMON-RULES.md`, `.tmp/concertation-share/converged-r2.md` (§2, §7 G1 row), `.tmp/concertation-share/owner-answers.md`.
  - [x] Create isolated worktree `tmp/worktrees/share-g1` on branch `feat/share-g1-access-model` from `origin/main` (HEAD 88078a995); `cp ../../.env .env`.
  - [x] Make targets captured: `make test-artifacts SCOPE=… ENV=test-share-g1`, `make test-artifacts-integration SCOPE=… ENV=test-share-g1`, `make typecheck-artifacts`, `make lint-artifacts`, `make build-artifacts`, `make down ENV=test-share-g1`, `make scope-check`, `make commit MSG="…"`.
  - [x] Environment mapping: unit/integration tests on `ENV=test-share-g1` only (COMPOSE_PROJECT_NAME=test-share-g1).
  - [x] Command style confirmed: `flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md make … ENV=test-share-g1` with `ENV` last, lock per command.
  - [x] Scope boundaries declared above; no exceptions needed.
- [x] **Lot 1 — Tests first (G1 acceptance matrix)**
  - [x] `packages/artifacts/tests/access.test.ts` (evolve): full matrix modes (restricted/platform/public) × actors (anonymous, unapproved, invited read, invited source/collab, approved third party, owner, admin) × policy on/off; approval freshness at read (suspension cuts next read, Q2: reactivation resumes automatically); public = anonymous read only when policy allows, never source; platform = approved read only; collab (source) only via nominative grant in restricted mode, at most one source grant (owner Q1); `canManageAccess` matrix incl. owner transitions, admin list/revoke/degrade-only, unique admin `grant sentropic:platform` degradation public→platform, `revoke sentropic:platform` on public = no-op, admin cannot widen or grant nominative.
  - [x] `packages/artifacts/tests/sharing-policy.test.ts` (new): `SharingPolicyPort` resolution fail-closed (absent/error/malformed ⇒ disallow); profile rule key `allowPublicSharing` admitted by `validateArtifactProfile`/`compileArtifactsProfile` ruleKeys, absent ⇒ false, boolean-typed, covered by `profileDigest` (digest changes when set); double lock = profile capability AND runtime port.
  - [x] `packages/artifacts/tests/migration.integration.test.ts` (evolve): apply 0003–0006 in beforeAll; 0006 proof — `access_mode` column + CHECK of the three values, `is_public=true → 'platform'` backfill and zero artifacts become `public`, existing grants untouched (zero loss), `artifact_access_events` exists and is append-only (UPDATE/DELETE rejected), Q1 schema enforcement: `source` grant rejected when mode ≠ restricted (trigger), second `source` grant rejected (partial unique index), widening mode with a live `source` grant rejected (trigger).
  - [x] `packages/artifacts/tests/postgres.integration.test.ts` (evolve): ACL round-trip carries `access_mode`; legacy `is_public=true` reads back as mode `platform`.
  - [x] `packages/artifacts/tests/fixtures/transport-world.ts` + `tests/http-routes.test.ts` + `tests/parity-*.test.ts` (evolve doubles): management unit double speaks `access_mode`/sentinels; receipt no longer forces `isPublic:false`.
  - [x] Scoped runs while evolving: `flock … make test-artifacts SCOPE=tests/access.test.ts ENV=test-share-g1` (and per-file), then `make test-artifacts ENV=test-share-g1`.
  - [x] Integration: `flock … make test-artifacts-integration SCOPE=tests/migration.integration.test.ts ENV=test-share-g1`, then full `make test-artifacts-integration ENV=test-share-g1`; `flock … make down ENV=test-share-g1` after each stack.
  - [x] Lot gate: `make typecheck-artifacts ENV=test-share-g1`, `make lint-artifacts ENV=test-share-g1`.
- [x] **Lot 2 — Implementation (G1)**
  - [x] `packages/artifacts/migrations/0006_sharing.sql` (new, additive): `artifacts.access_mode` TEXT NOT NULL DEFAULT 'restricted' CHECK IN ('restricted','platform','public'); backfill `is_public=true → 'platform'`; `artifact_access_events` append-only audit table (+ trigger rejecting UPDATE/DELETE); Q1 constraints: partial unique index one `source` grant per artifact, trigger rejecting `source` grant when mode ≠ 'restricted', trigger rejecting mode widening while a `source` grant exists.
  - [x] `src/server/access.ts`: `AccessMode` type, `ArtifactAcl.accessMode?`, `evaluateAccess` with policy context (default closed) + approval freshness on grant/platform paths + public anonymous read only when policy allows; `canManageAccess` (owner / admin-reduce-only, sentinel transitions §2.1); `grantAccess`/`revokeAccess` updated (single source grant, source only in restricted).
  - [x] `src/server/ports.ts`: `SharingPolicyPort` + `SharingPolicy` + fail-closed resolver helper.
  - [x] `src/profile/contracts.ts` + `src/profile/index.ts`: `ArtifactProfileRules.allowPublicSharing?: boolean`; ruleKeys whitelist + type validation; digest coverage (rules are inside the digested profile).
  - [x] `src/adapters/postgres.ts`: read `access_mode` (legacy `is_public` as read projection `access_mode != 'restricted'`), write `access_mode` + keep `is_public` as projection.
  - [x] `src/adapters/postgres-management.ts`: read mode; `setAccess` implements sentinel transitions + nominative grants + audit event insert in the same transaction; remove both `is_public = false` writes.
  - [x] `src/server/management.ts`: `manageArtifact` wires `canManageAccess` (admin predicate resolved server-side only), `SharingPolicyPort` consulted inside the commit transaction (policyRevision barrier, never hashed), audit event with policyRevision; receipt carries `accessMode`, no `isPublic:false` write.
  - [x] `src/server/lifecycle.ts` + `src/server/summary.ts` + `src/http.ts` + `src/server/runtime.ts` + `src/content/handler.ts`: thread policy context into `canRead`/`evaluateAccess` call sites (fail-closed default).
  - [x] MCP definitions untouched: `src/mcp.ts`, `src/mcp-core.ts`, `src/profile/schemas.ts` `set_access` schema byte-identical (verify via existing parity tests).
  - [x] Lot gate: full `make test-artifacts ENV=test-share-g1` + `make test-artifacts-integration ENV=test-share-g1` green; `make down ENV=test-share-g1`; `make typecheck-artifacts`, `make lint-artifacts` green.
- [ ] **Lot 3 — Commit, bump, push, PR, CI**
  - [x] Atomic commits via `make commit MSG="…"` (≤150 lines each, specific `git add` only, BRANCH.md checkboxes updated in the same commits); no AI trailers.
  - [x] Bump `packages/artifacts/package.json` version (minor — new feature) strictly greater than `npm view @sentropic/artifacts version` (currently 0.2.6 published ⇒ bump to 0.3.0); `enforce-package-bump` CI gate.
  - [x] `make scope-check` before every commit.
  - [ ] Push `feat/share-g1-access-model` to origin (crash safety) after the commit wave.
  - [ ] Open READY PR (title/body from this BRANCH.md, English, test plan included), wait for exactly one CI run on the final head; report results. Known unrelated risk: `security-container` may be red on the libexpat CVE — report, do not fix.
  - [ ] Write report to `.tmp/rv/share-g1.md` (root workspace). Do NOT merge; do NOT delete BRANCH.md.
- [ ] **Lot 4 — Review fixes PR #901 r1** (`.h2a/reviews/pr901-large4_r1.md`; design `.tmp/concertation-share/converged-r2.md` §2.3)
  - [x] D1: `src/http.ts` `visibleForManagement` evaluates `actorIsAdmin(actorId, storageScopeId) === true && isApprovedAccount(actorId) === true` per call — non-reader non-admin in scope, admin of another scope and unapproved admin all get `not_found` 404 (existence oracle closed); tests in `tests/sharing-management.test.ts` (non-reader non-admin in scope, admin of another scope, unapproved admin, approved admin of same scope = visible, right still 403 inside the transaction).
  - [ ] D2: `migrations/0006_sharing.sql` dedupes legacy multi-`source` artifacts deterministically before the unique index (oldest `created_at`, tie-break `principal_id`, stays `source`; later duplicates demote to `read`; no row deleted) + `src/adapters/postgres.ts` `putArtifactAcl` demotes a stale `source` grant to `read` when rewriting a non-restricted ACL; tests: duplicate fixture in `tests/migration.integration.test.ts`, adapter rewrite in `tests/postgres.integration.test.ts`.
  - [ ] Gates: `make test-artifacts ENV=test-share-g1`, `make test-artifacts-integration SCOPE=tests/migration.integration.test.ts|tests/postgres.integration.test.ts ENV=test-share-g1`, `make typecheck-artifacts`, `make lint-artifacts`, `make down ENV=test-share-g1`; scope-check per commit; push; one CI run on the final head; report `.tmp/rv/share-G1-fix-r1.md`.
