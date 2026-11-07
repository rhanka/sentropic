# Feature: hono-prod-maint-api

## Objective
Maintenance rebuild of the production api image from its exact source commit 836a82f88 with @hono/node-server 2.1.6 and hono 4.13.17 (GHSA-jpvv-r467-5p4w, GHSA-rmxm-3fg6-px4f, hono advisories of 2026-11-01). No other code change; the A4 cutover code stays out of prod.

## Scope / Guardrails
- Scope limited to the pinned dependency bump, the one-shot maintenance workflow and its SUT probe.
- Make-only workflow; the image is built and proven in CI by the one-shot workflow.
- In every make command, ENV=<env> must be passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `package.json`, `package-lock.json`, `api/package.json`, `api/package-lock.json`, `apps/llm-gateway/package.json`
  - `scripts/security/hono-sut/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/hono-prod-maint.yml` (exception BRHM-EX1: one-shot build-and-prove workflow; rollback: delete the file)
- **Exception process**:
  - BRHM-EX1 reason: a branch-only workflow is the only way to build the image in CI from this commit; impact: none on main; rollback: delete the branch.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: one dependency bump and one proof workflow.

## Plan / Todo (lot-based)
- [x] Lot 1 - Pinned lock bump (node-server 2.1.6, hono 4.13.17)
- [ ] Lot 2 - CI build, bundle proof, SUT probes, push by digest
- [ ] Lot 3 - GLM 5.3 review, deploy by digest, live verification
