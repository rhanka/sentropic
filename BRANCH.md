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
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/src/**`
  - `packages/artifacts/tests/**`
  - `packages/artifacts/migrations/0006_sharing.sql`
  - `packages/artifacts/package.json` (version bump only)
  - `packages/artifacts/CHANGELOG.md` (release entry)
  - `package-lock.json` (BR01-EX2, artifacts version line only)
  - `api/package-lock.json` (BR01-EX2, one-line `file:` sync)
  - `api/src/services/mcp/cluster-registry.ts` (BR01-EX6, APP-P1 manifest pin)
  - `api/src/services/artifacts/host-storage.ts` (BR01-EX7, pin 0006_sharing.sql asset)
  - `api/src/services/artifacts/reader-activation.ts` (BR01-EX7, thread live account approval into canRead)
  - `apps/artifact-content/src/host.ts` (BR01-EX7, forward isApprovedAccount to the content handler)
  - `apps/artifact-content/src/runtime.ts` (BR01-EX7, live approval predicate + canRead wiring)
  - `api/tests/api/artifacts-reader-activation.test.ts` (BR01-EX7, reset the append-only artifacts schema by drop+reinstall instead of cross-schema TRUNCATE CASCADE)
  - `api/tests/api/app-mcp-registry.test.ts` (BR01-EX6, pin vectors + refusal)
  - `api/tests/api/app-mcp-installed.test.ts` (BR01-EX6, provider version + pin)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (BR01-EX3)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (BR01-EX3)
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` (BR01-EX3)
  - `tools/memory-mcp-l5/artifacts/**` (BR01-EX5, P1 manifest regen)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`, `rules/**`
  - `api/**`, `ui/**`, `e2e/**`, `apps/**`, `deploy/**`
  - `packages/**` other than `packages/artifacts/**`
  - `src/**` (root app sources)
- **Conditional Paths**: none beyond Allowed Paths above (all exception-bearing paths are declared in Allowed Paths, which takes precedence over Forbidden).
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- BR01-EX2 (lock pins): the 0.2.10 release bumps the workspace package version, so the root `package-lock.json` `packages/artifacts` entry is refreshed through `make lock-root` (only the artifacts version line is kept; unrelated pre-existing staleness on main is reverted so the diff carries only this branch's change) and the single `"../packages/artifacts"` version line in `api/package-lock.json` is synced 0.2.8→0.2.10 (npm `--package-lock-only` does not refresh `file:` link versions — same targeted one-line sync as #878 BRP0B-EX1 / #893 BR01-EX2). No dependency graph change; rollback with the version fix.
- BR01-EX3 (cluster-mesh packaging fixture re-pin): the `validate-cluster-mesh` lanes run `tests/packaging/prepare-artifacts.spec.ts`, which requires the `selected` fixture to pin the workspace candidate version exactly (artifacts 0.2.10). Re-pinned `fixtures/selected/package.json` + `package-lock.json` through `make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock` and the hardcoded archive integrity in `artifacts-tuple.spec.ts` to the candidate tarball's sha512. Rollback: revert the three files to the 0.2.8 pin.
- BR01-EX5 (scope exception, `tools/memory-mcp-l5/artifacts/**`): after the rebase + the 0.2.10 root-lock refresh, the root lock differs from the lock the committed P1 manifest was generated against, so CI `memory-l5-qualification` would fail with « manifest P1 lock fingerprint mismatch ». Regenerate via `make memory-l5-pack STAGE=pre-candidate ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json` (never hand-editing digests); previous manifest+sidecar retained in `artifacts/history/`, one new immutable lock snapshot. Rollback: restore the retained history manifest/sidecar and delete the new snapshot.
- BR01-EX6 (APP-P1 pin): the provider version 0.2.10 changes the APP-P1 manifest digest, so `api/src/services/mcp/cluster-registry.ts` `APP_P1_MANIFEST_DIGEST` and the two app-mcp test fixtures are re-pinned to the digest computed through make (the profile digest and the four selected tool specs are unchanged — MCP tool definitions stay byte-identical). Never weaken the pin guard; a superseded-receipt refusal vector is added. Rollback: restore the 0.2.8 digest.
- BR01-EX7 (host installs the G1 migration and wires live approval, `api/src/services/artifacts/host-storage.ts` + `api/src/services/artifacts/reader-activation.ts` + `apps/artifact-content/src/host.ts` + `apps/artifact-content/src/runtime.ts`, plus the package-side `packages/artifacts/src/content/handler.ts` async approval port): G1 adds `packages/artifacts/migrations/0006_sharing.sql` and the 0.2.10 adapter reads/writes `artifacts.access_mode`, but the host pins artifact package assets explicitly (`artifactMigrationAssets`), so PR CI run 41651846843 failed with `column "access_mode" does not exist` in every API/app test DB (unit `apps/artifact-content/tests/runtime.test.ts` ×3, endpoints shards 2/3/4 via 500s on `artifacts_ensure` and direct errors in `artifacts-reader-activation.test.ts`). After pinning the asset, the remaining failures were `Artifact reader activation refused` (67 tests in `artifacts-reader-activation.test.ts`, 3 in `runtime.test.ts`): G1 owner Q2 makes `evaluateAccess` require a live `isApproved(actorId)` for read grants, but the host call sites (`reader-activation.ts` `currentPolicy`, `apps/artifact-content/src/runtime.ts` `current()` and the content handler's `canReadNow`) never passed the predicate, so the fail-closed default `() => false` denied every grant-based reader. Both are regressions from G1, fixed on the host side, not in tests: (1) append the `0006_sharing.sql` asset (id + pinned sha256 `038d9400…bfba`, resolved through `require.resolve` like 0004/0005) to `artifactMigrationAssets` and add `artifacts.artifact_access_events` to `requiredRelations`; (2) `reader-activation.ts` `currentPolicy` locks and reads the account-approval flag (users/tenants/tenant_memberships, FOR SHARE) on the transaction client and passes it as the `isApproved` closure to `canRead`; (3) `content/handler.ts` accepts an async `isApprovedAccount` (awaited per read in `canReadNow`, still fail-closed when absent — no security assertion weakened, MCP tool definitions unchanged); (4) `apps/artifact-content` `host.ts` forwards `isApprovedAccount` through `ContentHostOptions` and `runtime.ts` supplies the live DB approval predicate plus the `canRead` closure over the per-call authority read. Impact: the API migration runner applies 0006 on every boot (journal receipt, negative position like the other assets); reader activation and content serving re-check approval live exactly as owner Q2 requires. Rollback: drop the appended asset entry, the `requiredRelations` line, and revert the three host wiring hunks.
- Rebase on origin/main (353f08a8b): UNION resolution — every G1 change and the D1/D2 fixes kept; conflicts were `BRANCH.md` (kept this branch's content + the BRLOCK-EX1 line), `packages/artifacts/package.json` (0.3.0 → 0.2.10 per conductor allocation), `packages/artifacts/src/mcp-core.ts` (0.2.10 + main's get_source description) and `packages/artifacts/src/http.ts` (G1 policy wiring + main's mime/templates/base64/guideRef/versionUrl changes).
- Re-rebase on origin/main (2a63b2307, post-#895): conflicts were `BRANCH.md` (kept this branch's content; BRLOCK-EX1 line retained) and the P1 manifest + sidecar (kept this branch's regen, then regenerated again against the new HEAD via `make memory-l5-pack`; lockfiles auto-merged as union: artifacts 0.2.10 + mcp-platform 0.4.1).
- Re-rebase on origin/main (836a82f88, post-#896): UNION resolution — every G1 change, the D1/D2 fixes and #896's byte-stable tool definitions kept. Conflicts: `BRANCH.md` (branch content kept), `packages/artifacts/package.json` + both lockfiles (0.2.9 → 0.2.10 per conductor allocation), `mcp-core.ts` (0.2.10 + #896's definitions), `CHANGELOG.md` (0.2.10 entry above #896's 0.2.9 entry), APP-P1 pin files (re-pinned to the 0.2.10 digest recomputed through make against the union source), cluster-mesh fixtures (0.2.10 + integrity recomputed via the packaging make flow), P1 manifest (regenerated again post-rebase).

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- G1 touches no AI-generation path; no AI flaky tests expected.
- PR #901 CI run 41651846843, `test-e2e (group-a, 00 02 06 10)`: the only hard failure was `e2e/tests/00-ai-generation.spec.ts:181` « devrait générer des cas d'usage depuis l'accueil et vérifier les références » — `expect(locator('text=Références').first()).toBeVisible({ timeout: 30_000 })` never resolved. Evidence it is provider nondeterminism, not this branch: no 5xx in the e2e API log, the `POST /api/v1/initiatives/generate` job reached terminal and a use case completed (the test passed `waitForJobTerminal` + `waitForAnyUseCaseCompleted` and opened the initiative page), only the AI-emitted Références section was absent; the same run's allowlisted `ai/*` job timed out at 180s on `tests/ai/initiative-generation-async.test.ts` in the same time window (provider degraded); `02-organizations.spec.ts:182` was flaky and passed on retry #1; groups 06/10 fully green; main 836a82f88 and other PR heads pass this spec. G1 touches no AI-generation, search or citation path (`api/src/services/ai|initiative*|queue` never import `@sentropic/artifacts`). Recorded per the acceptance rule; no test amended, no timeout increased.

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
  - [x] Bump `packages/artifacts/package.json` version (minor — new feature) strictly greater than `npm view @sentropic/artifacts version` (0.2.8 published ⇒ bump to 0.2.10 per conductor allocation: #896=0.2.9 merges first, #901=0.2.10, #891=0.2.11; stays inside cluster-mesh's `>=0.2.0 <0.3.0` peer range); `enforce-package-bump` CI gate.
  - [x] `make scope-check` before every commit.
  - [ ] Push `feat/share-g1-access-model` to origin (crash safety) after the commit wave.
  - [ ] Open READY PR (title/body from this BRANCH.md, English, test plan included), wait for exactly one CI run on the final head; report results. Known unrelated risk: `security-container` may be red on the libexpat CVE — report, do not fix.
  - [ ] Write report to `.tmp/rv/share-g1.md` (root workspace). Do NOT merge; do NOT delete BRANCH.md.
- [ ] **Lot 4 — Review fixes PR #901 r1** (`.h2a/reviews/pr901-large4_r1.md`; design `.tmp/concertation-share/converged-r2.md` §2.3)
  - [x] D1: `src/http.ts` `visibleForManagement` evaluates `actorIsAdmin(actorId, storageScopeId) === true && isApprovedAccount(actorId) === true` per call — non-reader non-admin in scope, admin of another scope and unapproved admin all get `not_found` 404 (existence oracle closed); tests in `tests/sharing-management.test.ts` (non-reader non-admin in scope, admin of another scope, unapproved admin, approved admin of same scope = visible, right still 403 inside the transaction).
  - [x] D2: `migrations/0006_sharing.sql` dedupes legacy multi-`source` artifacts deterministically before the unique index (oldest `created_at`, tie-break `principal_id`, stays `source`; later duplicates demote to `read`; no row deleted) + `src/adapters/postgres.ts` `putArtifactAcl` demotes a stale `source` grant to `read` when rewriting a non-restricted ACL; tests: duplicate fixture in `tests/migration.integration.test.ts`, adapter rewrite in `tests/postgres.integration.test.ts`.
  - [ ] Gates: `make test-artifacts ENV=test-share-g1`, `make test-artifacts-integration SCOPE=tests/migration.integration.test.ts|tests/postgres.integration.test.ts ENV=test-share-g1`, `make typecheck-artifacts`, `make lint-artifacts`, `make down ENV=test-share-g1`; scope-check per commit; push; one CI run on the final head; report `.tmp/rv/share-G1-fix-r1.md`.
- [ ] **Lot 5 — CI fix for pull_request run 41651846843 (head 7a6217066)**
  - [x] Root cause read from job logs (gh): `test-api-unit-integration (unit)` — `apps/artifact-content/tests/runtime.test.ts` « durable app content composition » ×3 fail with `error: column "access_mode" does not exist` at `api/src/services/artifacts/reader-activation.ts:76` (`store.getArtifactAcl`); `(endpoints, 3)` — `tests/api/artifacts-reader-activation.test.ts` same error ×15; `(endpoints, 2)` and `(endpoints, 4)` — `artifacts-host-publication.test.ts` / `artifacts-host-credentials.test.ts` / `artifacts-host-recovery.test.ts` return 500 instead of 201 on `artifacts_ensure` (same missing column on the store read/write path). Verdict: regression from the G1 access model — the branch ships `0006_sharing.sql` and the 0.2.10 adapter queries `access_mode`, but the API host never installs the new asset. Fixed in code (BR01-EX7), no test adapted, no security assertion weakened.
  - [x] Fix, part 1 (schema): `api/src/services/artifacts/host-storage.ts` — append `@sentropic/artifacts/migrations/0006_sharing.sql` (sha256-pinned) to `artifactMigrationAssets`; add `artifacts.artifact_access_events` to `requiredRelations`.
  - [x] Fix, part 2 (approval wiring, found by re-running scoped tests after part 1): with the column present, 67 `artifacts-reader-activation.test.ts` tests + 3 `runtime.test.ts` tests still failed with `Artifact reader activation refused` — G1 owner Q2 requires a live `isApproved` predicate for read grants and the host call sites never passed it (fail-closed default). Wired on the host: `reader-activation.ts` `currentPolicy` approval read + `canRead` closure; `packages/artifacts/src/content/handler.ts` async `isApprovedAccount` port; `apps/artifact-content` `host.ts`/`runtime.ts` forward and supply the live predicate.
  - [x] Fix, part 3 (expected evolution, test adapted — no security assertion weakened): after parts 1–2 the 67 `artifacts-reader-activation.test.ts` tests failed with `error: append-only: artifact_access_events is immutable` — the 0006 audit trigger (BEFORE UPDATE OR DELETE OR TRUNCATE) fires when the file's beforeEach runs `TRUNCATE … artifacts.storage_scopes … CASCADE` (cascade reaches `artifacts.artifact_access_events`). This is the intended G1 behaviour (append-only audit), so the test now resets the package schemas with `DROP SCHEMA IF EXISTS artifacts CASCADE` + `DROP SCHEMA IF EXISTS artifact_host CASCADE` + deletion of the asset receipts + `installArtifactPackageAssets(pool)` (re-applies all 7 pinned assets — the activation asset uses plain `CREATE TABLE`, so its schema must be dropped too — and re-validates `requiredRelations`), and truncates only `control.artifact_host_kv`, `users`, `tenants` (verified: nothing outside the two package schemas references `artifacts.*` or `artifact_host.*`, and `storage_scopes.org_id` is plain text, so the remaining TRUNCATE CASCADE cannot reach the append-only table). The trigger itself is untouched and still covered by `packages/artifacts/tests/migration.integration.test.ts`.
  - [x] `make scope-check` before commit (BR01-EX7 declared in Allowed Paths + Feedback Loop; BRLOCK-EX1 line retained).
  - [x] Scoped tests on this lane's env, ENV last, one flock per make command: `flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md make test-app-cluster-mesh ENV=test-share-g1-ci` (covers `apps/artifact-content/tests` + all failing endpoint files incl. `artifacts-host-migrations.test.ts`), then `flock … make down-volumes ENV=test-share-g1-ci`.
  - [x] Commit via `make commit MSG="…"` (host-storage.ts + BRANCH.md only), push `feat/share-g1-access-model`, exactly one CI run on the new head.
  - [x] Report to `.tmp/rv/share-g1-ci-fix.md` (root workspace). Do NOT merge.
  - Note: `test-api-unit-integration (ai, …)` in run 41651846843 is the AI-flaky allowlisted job (180s timeout on `initiative-generation-async`), not in this lane's scope; `test-e2e (group-a)` hard failure is the AI Références flake recorded under « AI Flaky tests » above.
