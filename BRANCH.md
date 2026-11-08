# Feature: @sentropic/artifacts generic live invitations through MCP (0.2.22)

## Objective
- [ ] Generic live invitations in @sentropic/artifacts (cluster-mesh artifacts connector): four frozen tools, the session state exports, the postgres-live adapter and the host migration 0013_live_invitations.sql, per .tmp/rv/live-invitations-contract.md (s-archi 07/11 20:25, migration addendum 20:40/20:45). Rides train 1c.

## Scope / Guardrails
- [x] Branch feat/artifacts-live-invitations from origin/main c968b8d16; worktree tmp/worktrees/live-invit; ENV=test-live-invit.
- [x] Make only; no Python, attribution trailers, CI skips, reruns or CI polling; never ENV=dev.
- [x] Wagon: push the branch, no PR; the train 1c integration lane merges it.
- [x] The 35 existing tool definitions stay byte-identical; the 4 new ones are frozen at birth (snapshot 35 → 39).
- [x] `@sentropic/artifacts/live-host` unchanged; APP-P1 manifest unchanged (`ARTIFACTS_PROVIDER_VERSION` stays for the train repin).
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/**` (except `src/live-host/**`)
  - `packages/artifacts/tests/**`
  - `packages/artifacts/migrations/0013_live_invitations.sql`
  - `packages/artifacts/package.json` (version only)
  - `packages/artifacts/CHANGELOG.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/artifacts/src/live-host/**`
  - `api/src/**`
  - `apps/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json`, `api/package-lock.json` (BRLI-EX1: workspace version line only)
  - `.github/workflows/**`
- **Exception process**:
  - [x] BRLI-EX1: owner-requested bump to 0.2.22; rationale: `npm ci` needs the workspace version in both locks; impact: one version line per lock; rollback: revert the bump commit.

## Feedback Loop
- [ ] `attention`: train 1c repins `ARTIFACTS_PROVIDER_VERSION`, the APP-P1 digest and the cluster-mesh selected fixture.
- [ ] `attention`: immo drops its empty 0038 `artifacts.live_invitations` (0041, guarded on empty) before applying 0013.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** (wagon merged by the train 1c integration lane)

## Plan / Todo (lot-based)
- [x] **Lot 1 — Tests first**
  - [x] Service: owner-only invite, invitee rights, accept rules, revoke epoch, projections, state exports, limit, qualification, replays, onRevoked after commit.
  - [x] Definitions: 35 → 39 with the 35 previous definitions byte-identical.
  - [x] Migration: 0013 guard fails on a foreign `artifacts.live_invitations`; postgres-live adapter round trip.
- [x] **Lot 2 — Tools and routing**
  - [x] Four frozen definitions, capability names, profile routes, HTTP and MCP dispatch to `LiveService.execute`.
- [x] **Lot 3 — Service and storage**
  - [x] Invitation ledger in the live transaction (memory and postgres-live), invitation service, `liveInvitationState`, `liveViewer`.
  - [x] Migration 0013 with the mandatory column and index guard.
- [ ] **Lot 4 — Release and gate**
  - [ ] Version 0.2.22 and changelog.
  - [ ] `make typecheck-artifacts`, `make lint-artifacts`, scoped `make test-artifacts`, scoped `make test-artifacts-integration`.
  - [ ] Push the wagon; report .tmp/rv/live-invitations.md.
