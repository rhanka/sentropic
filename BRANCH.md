# Feature: app-cm-a4 — consolidated app identity cutover (A4.1+A4.2+A4.3)

## Objective
One lot: migrate app identity data (users, proofs, invitations, login sessions, tenants, both memberships, workspaces) into the cluster-mesh stores, switch the single author under the r13 D11 protocol with the rollback checkpoint recorded before any legacy table deletion, point every reader/writer at the CM stores, delete the legacy app identity tables/files, replace request-authority with F15, and land the F11 screens.

## Scope / Guardrails
- Scope limited to the app cutover: api identity read/write paths, one control data migration, ui F11 screens, e2e.
- One migration max: `api/drizzle/control/0014_app_cm_identity_cutover.sql` (control stream).
- Make-only workflow, no direct Docker commands; Docker under the packet flock; `make down ENV=<env>` after.
- Branch development in isolated worktree `tmp/worktrees/app-cm-a4-3` on branch `feat/app-cm-a4` from `origin/feat/cm-identity-a2-0b` (code against the A2.0b contract; missing A2.0b APIs are stack dependencies, recorded in the report, not implemented here).
- Test campaigns on `ENV=test-app-a4` / `ENV=e2e-app-a4` (ENV last), never root dev.
- All new text in English.
- No dual writer, no legacy fallback; the app keeps business data only.
- Pins: A2-lots.md sha256 015d821d066a6bcc368113adf3fa45dd73a32abebc2f37cedb5f4eb1ced8c0c2; r2.md (APPROVED) sha256 f24480ee9e39396c2ecfb71be790e2a5a247976be15980a18b185101542cd518; A2.0b amendment r6 sha256 5bde078cd12a35fb752eadb48496f0373dc8940883c701b920878a165; owner-answers-20261030.md sha256 01554c2f81d88f1c96815b5e4a60e7f5c91ad51622d637ca83af5422a578c1c7 (Q-G answered 2026-11-01: interim accepted); gap.fr.md; STOP reports .tmp/rv/lot-A4-2.md and .tmp/rv/lot-A4.2.md; base origin/feat/cm-identity-a2-0b.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/**`
  - `api/tests/**`
  - `api/drizzle/control/0014_app_cm_identity_cutover.sql` + `api/drizzle/control/meta/**`
  - `ui/src/**`
  - `ui/tests/**`
  - `e2e/tests/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/**` (A2.0b owns cluster-mesh; contract gaps are stack dependencies)
  - `.github/workflows/**`
  - `spec/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` public stream (not used; control stream only)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- None.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single consolidated lot; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: conductor decision 2026-10-31T22:57Z consolidated A4.1+A4.2+A4.3 into ONE lot (tables interlinked; splitting failed twice: .tmp/rv/lot-A4-2.md, .tmp/rv/lot-A4.2.md). Stacked on feat/cm-identity-a2-0b; draft PR with base feat/cm-identity-a2-0b while A2.0b is open; rebase onto origin/main after A2.0b merges; one CI run on the final head.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- F11 screens land in this lot; e2e on ENV=e2e-app-a4 covers them.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read COMMON-RULES, MASTER, A2-lots, r2 §5/§9.3, gap.fr.md, STOP reports, A2.0b r6, owner answers (Q-G recorded), workflow.
  - [x] Worktree `tmp/worktrees/app-cm-a4-3`, branch `feat/app-cm-a4` from origin/feat/cm-identity-a2-0b head; harness C1 PASS.
  - [x] BRANCH.md from plan/BRANCH_TEMPLATE.md.
  - [x] ENV mapping: test-app-a4 / e2e-app-a4; ports API_PORT=9640 UI_PORT=5840 MAILDEV_UI_PORT=1740.
  - [x] Resume C1 PASS; review inherited account, challenge and invitation fixtures; restore original email data.
  - [x] Review inherited session, magic-link and WebAuthn fixtures without weakening assertions.
  - [x] Correct CM fixture cleanup for indirect session, operation, invitation and outbox references.
  - [x] Review session-adoption setup and tenant-bound authorization fixtures against CM stores.
  - [x] Review document, history, stream and lock fixture conversions; preserve original email values.
  - [ ] Docker stack under flock, `make down ENV=test-app-a4` after.
- [ ] **Lot 1 — CM identity composition + one data migration**
  - [ ] App-side CM identity composition (core stores, tenancy stores, custody host/UOW, F15 producer, atomic deletion V2, importer) over the app Postgres.
  - [ ] Control migration 0014: CM identity schema + id-preserving copy of users/proofs/invitations/login sessions/tenants/memberships/workspaces + rollback checkpoint row; journal integrity test passes.
  - [ ] Migration tests (both directions of the copy, id preservation, counts).
  - [x] Add isolated PostgreSQL cutover tests for checkpoint retention, rollback and OAuth invalidation.
- [ ] **Lot 2 — Author switch (r13 D11) + reader/writer cutover**
  - [ ] /auth + /session over CM custody stores (auth-hono ports backed by CM); delete registration.ts, account.ts, session-manager identity paths.
  - [ ] /workspaces (absorbs /tenants) over A2.2 stores; delete tenant-membership.ts, membership seam in cluster-mesh-adapter.ts, product tenant/workspace identity routes.
  - [ ] resolution + tid + admin + F15: delete resolve-tenant.ts, TENANT_RESOLUTION_MODE, OAuth tid legs, identity parts of admin-product-authority.ts; replace request-authority.ts with F15.
  - [ ] Account deletion through the A2.3/A2.0b atomic cascade (V2), self + admin handlers.
  - [ ] Rollback checkpoint recorded BEFORE any legacy table deletion; one author per namespace via cutover records.
  - [ ] All residual readers of legacy identity tables switched to CM stores (46-file inventory).
- [ ] **Lot 3 — Deletions**
  - [ ] Drop legacy identity tables in migration; delete identity part of api/src/db/schema.ts and the named files; no dual writer, no legacy fallback.
- [ ] **Lot 4 — F11 screens + e2e**
  - [ ] Login, registration, admin, membership decision, members screens; e2e on ENV=e2e-app-a4.
- [ ] **Lot 5 — Tests**
  - [ ] gap-§1 scenario end to end; registration → approval → login; invitation consumed once; revoke-all; mid-session suspension empties tool set; account deletion with injected failure leaves no orphan and preserves rows; migration tests; F11 e2e.
  - [ ] Rehearse migration on a fresh prod dump (existing rehearsal make target); record receipt.
- [ ] **Lot 6 — Final validation**
  - [ ] typecheck/lint api+ui; targeted make tests; push often; draft PR base feat/cm-identity-a2-0b.
  - [ ] ONE CI run on the final head (after rebase onto origin/main once A2.0b merges).
  - [ ] Report to .tmp/rv/lot-A4.md; stop; do not merge.
