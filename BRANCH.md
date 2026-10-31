# Feature: Preprod-only immo artifact scopes on the IdP

## Objective
Grant the preprod `immo-mcp` PKCE client the explicit scopes `immo:artifacts:read` and `immo:artifacts:write` (resource `https://preprod.immo.sent-tech.ca/mcp`), advertise them in the AS `scopes_supported` metadata and label them on the consent screen. Prod is untouched: the prod `immo-mcp` row keeps its three immo scopes.

## Scope / Guardrails
- Scope limited to the preprod IdP client governance (idp-identity-sync preprod overlay), AS metadata, consent labels, and their tests.
- Owner decision relayed by immo: PREPROD ONLY; any change to the prod client path must be refused and reported.
- Preprod client rows for allowlisted clients are rewritten from prod on each sync (`sync-clients.sql` upsert overwrites `allowed_scopes`), so a manual preprod-only DB edit would be reverted. The divergence is therefore expressed inside the preprod sync desired state (`client-policy.sql`) and asserted by the exact client postcondition.
- No migration (`api/drizzle/*.sql`).
- Make-only workflow, no direct Docker commands.
- Branch development happens in isolated worktree `tmp/worktrees/preprod-immo-scopes`.
- Automated test campaigns run on dedicated environments (`ENV=test-*`), never on root `dev`.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- No Docker compose stack in this lane (machine-load rule); the targeted gates are one-off `docker run` containers. `make down ENV=<env>` after any stack use.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/k8s/overlays/preprod/idp-identity-sync/client-policy.sql`
  - `deploy/ci/idp-identity-sync/fixtures/assert-committed.sql`
  - `deploy/ci/idp-identity-sync/authorize.selftest.mjs`
  - `deploy/ci/idp-identity-sync/README.md`
  - `api/src/routes/namespaces/oauth-ingress.ts`
  - `api/tests/api/auth/oauth-wellknown.test.ts`
  - `api/tests/api/cluster-mesh-oauth-roots.test.ts`
  - `packages/auth-ui/src/labels.ts`
  - `packages/auth-ui/package.json`
  - `packages/auth-ui/tests/oauth-consent.test.ts`
  - `spec/SPEC_EVOL_IDP_OAUTH_CLIENT_SYNC.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `deploy/ci/idp-identity-sync/fixtures/prod.sql` (the synthetic prod `immo-mcp` row keeps `immo:read`, `immo:search`, `immo:documents:read`)
  - `deploy/k8s/overlays/prod/**`
  - `.github/workflows/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file) — not used
  - `.github/workflows/**` — not used
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- None open. The prod path (`fixtures/prod.sql`, `deploy/k8s/overlays/prod/**`) is explicitly out of scope; any request to change it on this branch is refused and reported to the owner.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- Record (BRA21-FLAKE1): `make test-cluster-mesh ENV=test-cm-a2-1` at head `7ef805dbf` failed 13 tests, every one with signature `Error: Test timed out in 5000ms` (`tests/engram-memory/sqlite-roundtrip.spec.ts`, `tests/storage/instance-ownership.spec.ts`, `tests/storage/sqlite-capabilities.spec.ts`, `tests/storage/sqlite-corpus.spec.ts`, `tests/storage/sqlite-lanes.spec.ts`, `tests/storage/sqlite-s0-identity.spec.ts`, `tests/storage/sqlite-s0.spec.ts`) while parallel lanes held the shared machine at load average ~25; unrelated to this branch (no kernel or frozen-spec change; the same command at the same head passed 1471/1471 once the machine quieted); no test amended, no timeout raised.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one small governance change across sync SQL, metadata and labels; single branch, single CI.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT happens after merge during the owner-gated preprod CD acceptance (dry-run dispatch, then real run), not on this branch. Local gates prove the committed row and authorize behavior synthetically.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md` and `deploy/ci/idp-identity-sync/README.md`.
  - [x] Confirm isolated worktree `tmp/worktrees/preprod-immo-scopes` on branch `feat/preprod-immo-artifact-scopes` from `origin/main`.
  - [x] Confirm governance: preprod `immo-mcp` row converges from prod via `client-policy.sql` → `sync-clients.sql`, asserted by `client-postcondition.sql`; token scope issuance is the requested ∩ client-allowed intersection per resource (`authorize-handler.ts` `validateScope`, `token-handler.ts` `issueTokens`).
  - [x] Confirm consent label table exists: `packages/auth-ui/src/labels.ts` `scopeDescriptions` (default + French), rendered with raw-scope fallback in `OAuthConsent.svelte`.
  - [x] Confirm environment mapping: `ENV=test-idp-sync` for the sync gates, `ENV=test-immo-scopes` for package unit tests; no ports needed (one-off containers).

- [x] **Lot 1 — Preprod client governance divergence**
  - [x] Add the preprod-only scope augmentation for `immo-mcp` in `deploy/k8s/overlays/preprod/idp-identity-sync/client-policy.sql` (after `transformed_clients`, before `desired_clients`), appending `immo:artifacts:read` and `immo:artifacts:write` idempotently.
  - [x] Update `deploy/ci/idp-identity-sync/fixtures/assert-committed.sql` to assert the committed preprod row carries the five scopes.
  - [x] Update `deploy/ci/idp-identity-sync/authorize.selftest.mjs` committed-row scope assertion.
  - [x] Document the divergence in `deploy/ci/idp-identity-sync/README.md` (client convergence + synthetic acceptance) and `spec/SPEC_EVOL_IDP_OAUTH_CLIENT_SYNC.md`.
  - [x] Do not touch `fixtures/prod.sql` or `deploy/k8s/overlays/prod/**`.
  - [x] Lot gate:
    - [x] `make test-idp-sync-selftest ENV=test-idp-sync` (70 PASS, 0 failures)
    - [x] `make test-idp-sync-sql ENV=test-idp-sync` (committed 5-scope row asserted; rerun 0/0; authorize 302/400/invalid_target green)

- [x] **Lot 2 — AS metadata and consent labels**
  - [x] Add the two scopes to `additionalScopesSupported` in `api/src/routes/namespaces/oauth-ingress.ts`.
  - [x] Add consent labels for the two scopes to `packages/auth-ui/src/labels.ts` (default + French `scopeDescriptions`).
  - [x] Bump `packages/auth-ui/package.json` version (0.7.7 → 0.8.0, additive labels feature).
  - [x] Update `packages/auth-ui/tests/oauth-consent.test.ts` label assertions.
  - [x] Update `api/tests/api/auth/oauth-wellknown.test.ts` and `api/tests/api/cluster-mesh-oauth-roots.test.ts` `scopes_supported` expectations.
  - [x] Lot gate:
    - [x] `make test-auth-ui ENV=test-immo-scopes` (54/54 passed, consent label assertions green)
    - [ ] API endpoint tests (well-known, cluster-mesh roots) verified by branch CI (compose stack avoided in this lane per machine-load rule).

- [x] **Lot N-1 — Docs consolidation**
  - [x] Spec and README updates handled inside Lot 1 (no `spec/BRANCH_SPEC_EVOL.md` needed for a branch of this size).

- [ ] **Lot N — Final validation**
  - [x] `make scope-check`-equivalent mechanical scope check before each commit (host `harness check scope`).
  - [x] Targeted gates re-run clean on the final head.
  - [x] Bumped `packages/auth-ui/package.json` version for `src/**` change — enforced by CI `enforce-package-bump`.
  - [ ] Final gate step 1: create PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: one CI run on the final head; resolve remaining blockers.
  - [ ] Final gate step 3 (owner-side, after merge): dispatch the `IdP identity sync` workflow per the apply step in the lane report; merge decision belongs to the owner.
