# Feature: First-member tenant bootstrap (T1 prod A4 prerequisite)

## Objective
- [ ] Let an active `admin_app` approve its OWN pending membership request once, only while the tenant has no approved member, so the first member of a tenant can exist after the A4 cutover (explicit memberships = 0, `.tmp/rv/tenant-memberships-gap.md` §1); every other self-decision keeps `SelfActionForbiddenError`.

## Scope / Guardrails
- [x] Branch fix/cm-first-member-bootstrap from origin/main c22163106; worktree tmp/worktrees/t1-cm-first-member-bootstrap; ENV=test-t1a-bootstrap; API_PORT=9272 UI_PORT=5472 MAILDEV_UI_PORT=1372.
- [x] Make only; no Python; no attribution trailers; never ENV=dev; wagon pushes its branch only (no PR, no version bump, no lock regeneration).
- [x] App wrapper only: the cluster-mesh domain (`decideMembership`, audit) stays unchanged; no migration.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/identity/cm-membership.ts`
  - `api/tests/api/auth/tenant-first-member-bootstrap.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `ui/**`
  - `deploy/**`
  - `packages/**`
  - `api/drizzle/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `docs/runbooks/**`
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [ ] None.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command). Not applicable so far.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**
- Rationale: T1 wagon; the train lane merges every wagon into one train branch with one PR and one CI.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Tests first**
  - [x] `api/tests/api/auth/tenant-first-member-bootstrap.test.ts`: admin_app self-approval of a `requested` row in a tenant with no approved member (status, decidedBy, `membership.approved` audit by the caller); second self-approval refused once a member exists; non-admin_app refused; `invited`/`suspended`/absent rows refused; self-reject refused, self-suspend unchanged.
- [ ] **Lot 2 — Guard**
  - [ ] `cm-membership.ts`: the self-decision check runs after the tenant workspace locks, inside the SERIALIZABLE write, and admits only the first-member bootstrap.
- [ ] **Lot 3 — Validation**
  - [ ] `make typecheck-api` and `make lint-api`.
  - [ ] Scoped API tests: `tenant-first-member-bootstrap`, `tenant-membership`.
  - [ ] Opus read-only review in `.h2a/reviews/t1-cm-first-member-bootstrap-opus.md`.
