# Feature: OAuth refresh token for the Sentropic IdP — specification

## Objective
- Specify standard OAuth 2.0 refresh token issuance, rotation on every use, reuse detection, revocation, hashed persistence, and 15-day absolute lifetime on the Sentropic IdP for authorized MCP and relying-party clients, delivered with the cluster-mesh migration while keeping access tokens short (1 h).

## Scope / Guardrails
- Scope limited to `spec/**` and `BRANCH.md` only.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/idp-oauth-refresh-token` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Docs only on this branch: no code, deployment, publication, seed execution, or merge.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `rules/**`
  - `api/**`
  - `ui/**`
  - `apps/**`
  - `e2e/**`
  - `packages/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] No `blocked` / `deferred` / `cancelled` / `attention` item open; raise one here instead of guessing if a prerequisite is unresolved.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- [x] Not applicable on this docs-only branch: no API, UI, or E2E test run is claimed; future lane gates are specified inside the new spec.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single docs-only spec authoring with cross-references; future implementation lots are specified inside the new spec and are not branches of this work.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/idp-oauth-refresh-token`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/sentropic`, `ENV=dev`).
  - Switch back to `tmp/worktrees/idp-oauth-refresh-token` after UAT.
- [x] This branch has no UI change: UAT is an owner read of the new spec and cross-references on the draft PR; no service start and no `ENV=dev` test run.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `plan/BRANCH_TEMPLATE.md`, and the launch packet baseline at `9ed96eb83`.
  - [x] Confirm isolated worktree `/home/antoinefa/src/sentropic/tmp/worktrees/idp-oauth-refresh-token` on `spec/idp-oauth-refresh-token` with `git -C <worktree> branch --show-current`.
  - [x] Run `harness check branch` and record result: PASS C1 (sentropic).
  - [x] Confirm docs-only scope: verification is `make scope-check ENV=test-idp-oauth-refresh-token` with `ENV` last; no API, UI, or Maildev port is allocated or started.
  - [x] Confirm scope and guardrails: `spec/**` + `BRANCH.md` only, commits at most 150 lines via `make commit`, no AI attribution, draft PR only, never merge.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed: none required.
  - [x] Read merged baseline code and cite `file:line`: `api/src/config/env.ts`, `packages/auth-hono/src/oauth/authorize-handler.ts`, `packages/auth-hono/src/oauth/token-handler.ts`, `packages/auth-hono/src/oauth/wellknown-handler.ts`, `packages/auth-hono/src/oauth/revoke-handler.ts`, `packages/auth-hono/src/oauth/introspect-handler.ts`, `packages/auth-hono/src/oauth/token-exchange-handler.ts`, `api/src/services/auth/oauth-state-adapter.ts`, `api/src/db/schema.ts`, `packages/mcp-auth/src/core.ts`, `packages/llm-mesh/src/enrollment/seat-bundle.ts`.
  - [x] Read neighbouring specs and inputs: `/home/antoinefa/src/sentropic/.tmp/idp-refresh-token/OWNER-DECISION.md`, `/home/antoinefa/src/sentropic/.tmp/idp-refresh-token/radar-enquete-astra.md`, `spec/SPEC_EVOL_IDP_PER_APP_MFA_RECOVERY.md` (PR #695), `spec/SPEC_EVOL_CLUSTER_MESH_MCP_REGISTRY_ARTIFACTS.md` (PR #692), `spec/SPEC_EVOL_CI_SEATS.md`, `spec/SPEC_DECISION_TIER_AUTH_PATTERN.md`, `spec/SPEC_EVOL_IDP_OAUTH_CLIENT_SYNC.md`, `spec/SPEC_EVOL_AUTH_39E_MULTITENANT.md`, `spec/WORKFLOW_AUTH.md`.
- [ ] **Lot 1 — Author `spec/SPEC_EVOL_IDP_OAUTH_REFRESH_TOKEN.md`**
  - [x] Record verbatim owner decision (`OWNER-DECISION.md`), radar Astra investigation findings (`radar-enquete-astra.md`), and verified `origin/main` baseline (`9ed96eb83`) with `file:line` citations.
  - [x] Specify threat model, refresh token family data model (opaque token, SHA-256 hash only, family lineage, 15-day absolute ceiling, 1-hour access token unchanged), and comparison with the seat refresh model (`seat-bundle.ts`, `SPEC_EVOL_CI_SEATS.md`).
  - [x] Specify client eligibility (`grant_types` containing `refresh_token`), `offline_access` scope semantics vs MCP native refresh clients (claude.ai), discovery metadata (`wellknown-handler.ts`), and authorize/consent/token/revoke/introspect/end-session contracts.
  - [x] Specify atomic rotation on every use, reuse detection (family-wide revocation + issued access token revocation), DPoP/PKCE/client-auth bindings, RFC 8707 `resource` sealing and downscoping, live user/tenant/consent revalidation on refresh, and interaction with per-client MFA (`required_acr`, `allowed_user_ids`, PR #695 `maxMfaAgeSeconds` / `security_generation` / `kvm-gateway` exclusion or step-up).
  - [x] Specify interaction with `packages/mcp-auth` (`0.2.2` `403 insufficient_scope` fix, PRM canonical path), cluster-mesh MCP registry and RFC 8693 token exchange (PR #679, PR #692: exchanged workload tokens never carry refresh tokens; refreshed human access tokens remain valid subjects for token exchange), and tier identity sync (`export-prod.sql`, `import-preprod.sql`).
  - [x] Specify test plan at file granularity, implementation lots for BUILD branches, and owner decisions (in French, only if any remain open beyond the closed owner decision).
  - [x] Reconcile the parallel Astra max analysis (`/home/antoinefa/src/sentropic/.tmp/idp-refresh-token/analysis-astra.md`) into the spec when it lands; record each point taken or rejected with reason in `/home/antoinefa/src/sentropic/.tmp/idp-refresh-token/reconciliation.md`.
  - [x] **API tests**: existing `none`, updated `none`, new `none` on this branch; future suites stay specified in the new spec test plan.
  - [x] **UI tests (TypeScript only)**: existing `none`, updated `none`, new `none` on this branch; future suites stay specified in the new spec test plan.
  - [x] **E2E tests**: existing `none`, updated `none`, new `none` on this branch; future suites stay specified in the new spec test plan.
  - [x] Lot gate: `make scope-check ENV=test-idp-oauth-refresh-token` passes with only `spec/**` + `BRANCH.md` changed; no typecheck, lint, build, or test claim is made for this docs lot.
  - [ ] UAT (docs read): owner reads the new spec and confirms the refresh-token contract and lot breakdown; no dated receipt for this document is available.
- [ ] **Lot 2 — Cross-references in related specs**
  - [x] Add a cross-reference from `spec/SPEC_DECISION_TIER_AUTH_PATTERN.md` to the new spec (per-client `refresh_token` grant registration and tier-local refresh families).
  - [x] Add a cross-reference from `spec/SPEC_EVOL_IDP_OAUTH_CLIENT_SYNC.md` to the new spec (`grant_types` / `allowed_scopes` client convergence vs tier-local ephemeral refresh token rows).
  - [x] Add a cross-reference from `spec/SPEC_EVOL_AUTH_39E_MULTITENANT.md` to the new spec (live `tid` membership revalidation on `refresh_token` grant).
  - [x] Add a cross-reference from `spec/WORKFLOW_AUTH.md` to the new spec (distinction between browser session refresh `/auth/session/refresh` and OAuth `refresh_token` grant).
  - [x] Check `spec/SPEC.md` for a SPEC_EVOL index and record the finding in this file; edit only if an index exists (`spec/SPEC.md` has no `SPEC_EVOL` index; left unchanged).
  - [x] Lot gate: `make scope-check ENV=test-idp-oauth-refresh-token` passes; every new link resolves to an existing file in this branch.
  - [ ] UAT (docs read): owner follows each cross-reference to the new spec and back to the policy it extends; pending explicit receipt tied to the reviewed version.
- [ ] **Review round 1 — PR #699 (`pr699_sol.md`, target `393919d76d5ca65971aed472e015d3ec5bbc4167`)**
  - [x] Preserve the closed owner receipt verbatim; correct unsupported owner-UAT completion claims (finding 8).
  - [x] Define canonical digest and durable family/authorization serialization (findings 2 and 5); carry forward the existing partial evidence corrections.
  - [x] Complete current-policy and resource-aware offline-consent contracts and amendments (findings 1 and 3).
  - [ ] Correct revocation windows/citations/provenance and complete concrete regression/expiry acceptance (findings 4, 6 and 7).
  - [ ] Validate scope, write `.h2a/reviews/pr699_treatment.md`, push atomic commits and report head; never merge.
- [x] **Lot N-1 — Docs consolidation**
  - [x] Confirm the new spec reuses merged mechanisms without duplicating them and contains no secret value, only variable names.
  - [x] Confirm `BRANCH.md` checkboxes reflect the completed lots with this commit.
- [x] **Lot N — Final validation**
  - [x] Run `make scope-check ENV=test-idp-oauth-refresh-token` and record its result: PASS C2 (sentropic).
  - [x] Confirm every commit on this branch is at most 150 changed lines and was created with `make commit` without AI attribution.
  - [x] Push `spec/idp-oauth-refresh-token` and open a DRAFT PR whose body is this `BRANCH.md` text (Draft PR #699); report the PR number and head SHA, then stop without merging.
  - [x] Retest UI: not applicable, docs only, no UI test claimed.
  - [x] Retest API: not applicable, docs only, no API test claimed.
  - [x] Retest E2E: not applicable, docs only, no E2E test claimed.
  - [x] Package version bump: not applicable, no `packages/<pkg>/src/**` file changed.
