# Feature: app-cm-a4 — consolidated app identity cutover (A4.1+A4.2+A4.3)

## Objective
One lot: migrate app identity data (users, proofs, invitations, login sessions, tenants, both memberships, workspaces) into the cluster-mesh stores, switch the single author under the r13 D11 protocol with the rollback checkpoint recorded before any legacy table deletion, point every reader/writer at the CM stores, delete the legacy app identity tables/files, replace request-authority with F15, and land the F11 screens. Cutover (2026-11-04, PR #879): rebased onto `origin/main` past the A2.0b merge (#882), the G1–G5 train (#912) and the 2026-11-04 train (#914, `b9cdb2d33`); fold lot G0 (#906, superseded); consume G1–G5 in the app (lot G6, four series, no fallback); prepare the preprod sync replacement up to a dry run only (lot G7, no preprod run without the owner nominative list). Lane 2026-11-05: rebased onto `origin/main` past #915 (`4d7517d94`, union); fixed review r1 D1/D2 + the 0014→0015 comment; ported the revocation tests to the CM sweep path with the R1/R2 root fixes above.

## Scope / Guardrails
- Scope limited to the app cutover: api identity read/write paths, one control data migration, ui F11 screens, e2e; plus G6 CM-consumption swaps and the G7 ops replacement (scripts + idp-identity-sync overlays).
- One migration max: `api/drizzle/control/0015_app_cm_identity_cutover.sql` (control stream; slot 0015, main owns 0014).
- Make-only workflow, no direct Docker commands; each Docker-using make command through `.tmp/packets/docker-slot.sh make ...`, one slot per command, never nested; `make down-volumes ENV=<env>` after every test stack.
- Branch development in isolated worktree `tmp/worktrees/app-cm-a4-3` on branch `feat/app-cm-a4` (base `main` since #882 merged; PR #879 retargeted).
- Test campaigns on `ENV=test-a4-cutover` (ENV last), never root dev; never `ENV=dev`.
- All new text in English.
- No dual writer, no legacy fallback; the app keeps business data only.
- Pins: a4-cm-gaps-r2.md (binding design, lots G0/G6/G7); A2.0b amendment r6 sha256 5bde078cd12a35fb752eadb48496f0373dc8940883c701b920878a165; owner-answers-20261030.md (Q-G interim accepted; Q-K=A with HMAC + .env/k8s rotation; Q-WS1 deleted-with-workspace; Q-IDP1 case-by-case with nominative consent); PR #879 base `main` at `b9cdb2d33` (train #914; G1–G5 arrived via #912 `a1d0a815a`).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `docker-compose.test.yml` (BRxx-EX16)
  - `packages/cluster-mesh/src/storage/identity/schema.ts` (BRxx-EX17)
  - `packages/cluster-mesh/src/identity-contracts/accounts.ts` (BRxx-EX15)
  - `packages/cluster-mesh/src/storage/identity/atomic-deletion.ts` (BRxx-EX15)
  - `packages/cluster-mesh/tests/identity-lifecycle.spec.ts` (BRxx-EX15)
  - `api/src/**`
  - `api/tests/**`
  - `api/vitest.config.ts`
  - `api/drizzle/control/0015_app_cm_identity_cutover.sql` + `api/drizzle/control/meta/**`
  - `deploy/k8s/overlays/prod/idp-identity-sync/**` + `deploy/k8s/overlays/preprod/idp-identity-sync/**` (G7 ops replacement only)
  - `deploy/ci/idp-identity-sync/**` (G7 selftests only)
  - `ui/src/**`
  - `ui/tests/**`
  - `e2e/tests/**`
  - `packages/cluster-mesh/ui/**`
  - `packages/cluster-mesh/tests/ui/**`
  - `packages/cluster-mesh/package.json`
  - `ui/package.json` + `ui/package-lock.json`
  - `package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/cluster-mesh/src/**` (A2.0b owns backend contracts/implementation; gaps remain stack dependencies)
  - `packages/cluster-mesh/tests/identity/**`
  - `.github/workflows/**`
  - `spec/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` public stream (not used; control stream only)
  - `api/package.json` (build entries for the two G7 replica runners only, BRxx-EX2)
  - `apps/auth-idp/screen-smoke-seed.ts` + `apps/auth-idp/sso-smoke.ts` (CM identity seeding for the smoke flows only, BRxx-EX4)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (selected-fixture peer alignment only, BRxx-EX5)
  - `packages/cluster-mesh/tests/packaging/prepare.sh` (pack the auth-ui sibling for the frozen `latest` consumer only, BRxx-EX6)
  - `Makefile` (cluster-mesh candidate install-lane PEERS tuple only, BRxx-EX6)
  - `.github/workflows/ci.yml` (cluster-mesh post-publication/bootstrap qualify PEERS tuples only, BRxx-EX6)
  - `scripts/ci/publishable-ci-wiring.test.mjs` (CLUSTER_MESH_PEERS expectation only, BRxx-EX6)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

