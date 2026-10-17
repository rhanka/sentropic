# Feature: IdP per-client MFA policy (passkey acr/amr + required_acr + allowlist + registration Job)

## Objective
Implement the IdP changes from `.tmp/kvm-oidc/idp-oidc-answer.md` test-first in order B1+B2+B3+B4 then C1 then D1, so the owner requirement `je veux toujours un oidc enrole 2fa sur sent-tech.ca` holds for KVM clients without changing existing clients.

## Scope / Guardrails
- Scope limited to IdP session/OAuth MFA policy, per-client policy columns, registration script/Job, docs/specs.
- One migration max in `api/drizzle/*.sql` (0042 single file for required_acr + allowed_user_ids).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/idp-client-mfa-policy` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Env mapping for this branch: `ENV=test-idp-client-mfa-policy`, `API_PORT=9585`, `UI_PORT=5785`, `MAILDEV_UI_PORT=1685`.
- Never merge, never register a real client, never touch prod, no manual SQL.
- E1 (require_pkce=false for confidential) and E2 (RS256 in addition to EdDSA) only if the kvm session reports PKCE or EdDSA incompatibility; otherwise out of scope.
- Versions per Post-Rebase Gate: bump every `packages/<pkg>/package.json` whose `src/**` changed.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/auth-hono/src/oauth/**`
  - `packages/auth-hono/src/session.ts`
  - `packages/auth-hono/src/ports.ts`
  - `packages/auth-hono/src/webauthn-authentication*.ts`
  - `packages/auth-hono/tests/**`
  - `packages/auth-hono/package.json`
  - `packages/auth-hono/README.md`
  - `api/src/db/schema.ts`
  - `api/src/services/session-manager.ts`
  - `api/src/services/auth/oauth-state-adapter.ts`
  - `api/src/services/auth/webauthn-adapter.ts`
  - `api/src/services/webauthn-authentication.ts`
  - `api/src/services/webauthn-config.ts`
  - `api/src/routes/namespaces/auth/authentication.ts`
  - `api/src/routes/auth/oauth.ts`
  - `api/src/scripts/oauth-register-client.ts`
  - `api/tests/unit/auth/**`
  - `api/tests/unit/oauth-register-client.test.ts`
  - `api/tests/api/auth/**`
  - `api/tests/api/cluster-mesh-transfers-cutover.test.ts`
  - `api/tests/fixtures/historical/transfers-be37d69f6/**`
  - `api/drizzle/0042_*.sql`
  - `api/drizzle/meta/_journal.json`
  - `deploy/k8s/base/*oauth-register-client*`
  - `docs/oauth-client-*.md`
  - `spec/SPEC_DECISION_TIER_AUTH_PATTERN.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- (`Makefile` is Conditional via BR45-EX1, not Forbidden, so the exception applies.)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `Makefile` (D1 make target only, via BR45-EX1)
  - `deploy/k8s/**` (D1 Job only, plus sync-shape compat via BR45-EX2)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `BR45-EX1` (Makefile D1 target): reason: D1 requires a versioned root make target driving the client-registration Job; impact: one additive `oauth-register-client-job` target only, no other target touched; rollback: delete target, Job yaml remains unused.
- `BR45-EX2` (sync-shape compat): reason: `client-postcondition.sql` asserts exact `oauth_clients` row shape, so the B3/C1 columns break the idp-sync gate; impact: two column names added to the existing exclusion arrays (same treatment as tier-local `client_secret_hash`, policy stays per-tier and is never synced); rollback: revert one file (gate fails closed until then).
- E1/E2 gated on kvm-session incompatibility report; absent report means skip with `attention` note, no code.

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
- Rationale: ONE branch with internal lots per launch packet owner rule against salami slicing; all changes are IdP-scoped and sequential (B1->B2->B3->B4->C1->D1).

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/idp-client-mfa-policy`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/sentropic`, `ENV=dev`).
  - Switch back to `tmp/worktrees/idp-client-mfa-policy` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `rules/security.md`.
  - [x] Confirm isolated worktree `tmp/worktrees/idp-client-mfa-policy` on `feat/idp-client-mfa-policy`.
  - [x] Capture Makefile targets needed for debug/testing.
  - [x] Define environment mapping (`ENV=test-idp-client-mfa-policy`, `API_PORT=9585`, `UI_PORT=5785`, `MAILDEV_UI_PORT=1685`).
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BR45-EX1` for Makefile.
  - [x] Check `make ps-all ENV=test-idp-client-mfa-policy` single-build discipline.
- [x] **Lot 1 — B1 passkey login sets mfaVerified=true with UV**
  - [x] Thread `userVerified` from `verifyAuthenticationResponse.authenticationInfo` through `verifyWebAuthnAuthentication` (api) and `verifyAuthentication` (auth-hono + adapter) into `finalizeAuthentication` input.
  - [x] Extend `createSession` (`api/src/services/session-manager.ts`) with `mfaVerified` option; pass `true` only for passkey login with `userVerified=true`; keep magic-link/federation/registration at `false`.
  - [x] Fix README/code gap on `passkey-fresh` (`packages/auth-hono/README.md` only; no spec file touched).
  - [x] Gates: `typecheck-api`, `lint-api` (0 errors), `test-auth-hono` package files.
  - [x] **API tests**: `webauthn-authentication.test.ts` (role→required, discoverable; F3), `session-manager.test.ts` (default false, explicit true), new `passkey-mfa-session.test.ts` (route-level UV true/false → DB flag; F6); `authentication.test.ts` unchanged (rejection paths only).
  - [x] **UI tests**: none — no UI file touched.
  - [x] **E2E**: no new file; OAuth/webauthn specs verified green in CI (group-a).
- [x] **Lot 2 — B2 amr claim (RFC 8176)**
  - [x] Derive `amr` from session: `["hwk","user","mfa"]` when passkey+UV else `["pwd"]`; carry through `AuthCodePayload` + `TokenMeta` + continuation state.
  - [x] Emit `amr` in id_token, access_token, userinfo (+introspect); add `amr` to `claims_supported` in `wellknown-handler.ts`.
  - [x] Gates: package tests (`oauth-token`, `oauth-userinfo`, `oauth-wellknown`, incl. Bearer [REDACTED] case); api endpoint files unchanged; CI OAuth E2E green.
  - [x] **UI tests**: none — no UI file touched.
- [x] **Lot 3 — B3 required_acr per-client policy at authorize**
  - [x] Single migration `api/drizzle/0042_oauth_clients_mfa_policy.sql`: `required_acr text DEFAULT NULL` + `allowed_user_ids text[] DEFAULT '{}'` (both inert by default); journal entry 42.
  - [x] Extend `OauthClientRecord` + `oauth-state-adapter.ts` mapping + `oauth-register-client.ts` (`OAUTH_CLIENT_REQUIRED_ACR`, validated URN) + seed/test fixtures.
  - [x] Enforce at `authorize` main flow + `resumeLoginContinuation`: session acr below `required_acr` forces re-auth redirect; still-insufficient after resume (magic-link/Google/bearer session) returns `access_denied`; `prompt=none` → `login_required` (tested).
  - [x] Lot gate: `typecheck-api`, `lint-api`, scoped units/endpoints green; full `test-api` replaced by scoped gates + CI.
    - [x] **API tests**
      - [x] Update `api/tests/unit/oauth-register-client.test.ts` (required_acr + allowed_user_ids parse/validation)
      - [x] `api/tests/unit/auth/oauth-state-adapter.test.ts` unchanged (toMatchObject subset, defaults cover new columns)
      - [x] `api/tests/api/auth/oauth-authorize.test.ts` unchanged (no-policy clients unaffected)
      - [x] Add `api/tests/api/auth/oauth-client-policy.test.ts` (B3: bearer forced to login, MFA to consent; C1: non-listed access_denied, listed to consent)
      - [x] Add `packages/auth-hono/tests/oauth-client-required-acr.test.ts` (B3+B4 refusal paths, 8 tests)
      - [x] Add `packages/auth-hono/tests/oauth-client-allowlist.test.ts` (C1 refusal paths, 5 tests)
      - [x] Scoped runs: `make test-api-endpoints` oauth-authorize + oauth-client-policy green
      - [x] Sub-lot gate: full `test-api` replaced by scoped gates + CI (documented gate change)
    - [x] **UI tests (TypeScript only)**
      - [x] No UI change.
      - [x] Sub-lot gate: `make test-ui` not run (no `ui/**`, `apps/**` touched)
    - [x] **E2E tests**
      - [x] Existing `e2e/tests/02-auth-oauth-authorization-code.spec.ts` untouched; no-policy regression covered by CI.
- [x] **Lot 4 — B4 UV required for policy clients + C1 subject allowlist**
  - [x] B4: for `required_acr` clients, passkey without UV (`UV=false`) stays `mfaVerified=false` and is refused at authorize (no downgrade); `requireUserVerification` tightened on forced re-auth for policy clients.
  - [x] C1: same 0042 file adds `oauth_clients.allowed_user_ids text[] DEFAULT '{}'` (empty = no restriction); enforced at `authorize` AFTER forceReauth (F4) before consent with `access_denied`; register script extended (`OAUTH_CLIENT_ALLOWED_USER_IDS`, preserved on rotation per F5).
  - [x] Lot gate: `typecheck-api` + `lint-api` green.
    - [x] **API tests**
      - [x] B4 enforced via B1+B3 refusal (non-UV passkey mints mfaVerified=false, refused for policy clients; covered in `oauth-client-required-acr.test.ts`)
      - [x] C1 allowlist enforced + tested (`oauth-client-allowlist.test.ts` package, `oauth-client-policy.test.ts` API)
      - [x] `api/tests/unit/oauth-register-client.test.ts` allowlist parse covered in Lot 3 update
      - [x] Scoped runs: `make test-api-endpoints` oauth-authorize + oauth-client-policy green
      - [x] Sub-lot gate: full `test-api` replaced by scoped gates + CI (documented gate change)
    - [x] **UI tests (TypeScript only)**
      - [x] No UI change.
      - [x] Sub-lot gate: `make test-ui` not run (no `ui/**`, `apps/**` touched)
    - [x] **E2E tests**
      - [x] Existing OAuth E2E specs untouched; allowlist covered at API level (Dex/RP behavior out of scope).
- [x] **Lot 5 — D1 versioned Job + make target + rotation runbook**
  - [x] Added `deploy/k8s/base/36-oauth-register-client-job.yaml` (versioned Job, secret via `envFrom` temporary Secret, never CLI); root make target `oauth-register-client-job` under `BR45-EX1`. F1: `15-networkpolicy.yaml` egress rule; F2: make-target trap + pre-delete Secret/Job cleanup.
  - [x] Rotation runbook `docs/oauth-client-rotation.md` (90-day cycle, mint base64url 32 bytes, sha256 stored, immediate cutover, names only for secrets). F5: policy preserved on rotation unless explicitly provided.
  - [x] Updated `spec/SPEC_DECISION_TIER_AUTH_PATTERN.md` client procedure + `packages/auth-hono/README.md`.
  - [x] Bumped `packages/auth-hono/package.json` to 0.15.3 (patch: keeps `^0.15.0` dependents; 0.16.0 broke them, fixed in-branch).
  - [x] Lot gate: `typecheck-api` + `lint-api` green; `oauth-register-client.test.ts` (16 tests) green; Job dry-run OK.
    - [x] UAT step-level: Job yaml dry-run renders; make target prints usage without secrets; runbook has no secret material.
- [x] **Lot N-1 — Docs consolidation**
  - [x] Integrated into `spec/SPEC_DECISION_TIER_AUTH_PATTERN.md` (required_acr, allowlist, amr, UV).
  - [x] No scratch spec evol file to delete.
- [ ] **Lot N — Final validation (Argon NO-GO fixes in progress; push + DRAFT PR refresh pending)**
  - [x] Typecheck & Lint (`typecheck-auth-hono`, `typecheck-api`, `lint-api` 0 errors; all with `REGISTRY=local`)
  - [x] No UI change in branch: `test-ui` not run (no `ui/**`, `apps/**` file touched)
  - [x] Retest API scoped gates green (auth-hono full 196; api units + endpoints scoped green incl. policy 5, passkey-mfa-session 2)
  - [x] Flaky record: `oauth-token` 137 OOM + `oauth-userinfo` transient Error 1 under load 25, both green on immediate rerun (infra, unrelated to branch)
  - [x] Bumped `packages/auth-hono/package.json` to 0.15.3 (patch: keeps `^0.15.0` dependents; 0.16.0 broke them, fixed in-branch)
  - [x] Pushed; DRAFT PR #683 opened (body = BRANCH.md at push time; refresh pending after Argon fixes)
  - [x] CI run 38998031975 then 39006337986: all green except AI specs failing `no credits remaining` (OpenAI billing, affects main too)
  - [x] CI run 39038108646 red `test-api-unit-integration`: stale `webauthn-registration.test.ts` asserted pre-F3 `'preferred'` default; updated to F3 contract (`required` for known roles, `'preferred'` fallback pre-registration), 8/8 scoped green
  - [ ] Argon F1–F7 fixes committed test-first; push + refresh PR #683 body from BRANCH.md
  - [ ] CI green (modulo AI-billing external); report, stop; never merge
