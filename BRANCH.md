# Feature: Production hotfix for @hono/node-server GHSA-jpvv-r467-5p4w

## Objective
- [ ] Derive patched production images FROM the exact prod digests (api, auth-idp), replacing only @hono/node-server 1.19.17 with 1.19.18, then deploy by registry-only image switch.

## Scope / Guardrails
- [x] Scope limited to the derived-image recipe, its one-shot workflow, the regression probe and the vulnerability register.
- [x] No application code change; prod must not receive newer main code (A4 identity cutover needs its own signed procedure).
- [x] Branch `fix/hono-prod-hotfix`; worktree `tmp/worktrees/hono-prod-hotfix`; based on origin/main.
- [x] All new text in English.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json` (required by `scripts/ci/ci-lockfile-installs.test.mjs`, enforced by the `validate-publishable-manifests` CI job).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/security/hono-hotfix/**`
  - `scripts/security/hono-node-server.test.mjs`
  - `.security/vulnerability-register.yaml`
  - `.github/workflows/hono-prod-hotfix.yml` (BRHONO-EX1)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare reason, impact and rollback before conditional changes.

## Feedback Loop
- [x] BRHONO-EX1: owner GO for the prod hotfix; a reviewed workflow builds the derived images reproducibly and pushes to GHCR. Impact: one push-triggered, path-filtered workflow, no deploy step. Rollback: delete the workflow file after the images are recorded.

## AI Flaky tests
- [x] No flaky allowance, timeout or retry change.

## Plan / Todo (lot-based)
- [ ] **Lot 1 — Derived images**
  - [ ] Build, prove and push api and idp images via the workflow.
  - [ ] Independent review before deploy.
- [ ] **Lot 2 — Deploy**
  - [ ] Registry-only switch, rollout, health and live probe.
  - [ ] Register entries marked deployed.
