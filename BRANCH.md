# Feature: Remediate critical and high dependency alerts

## Objective
- [ ] Remediate all fixable open CRITICAL/HIGH Dependabot alerts and reassess existing image-size exceptions.

## Scope / Guardrails
- [x] Independent security PR on `fix/security-deps-critical-high`; orchestrator owns merge.
- [x] Docker/Make only; no application behavior changes; no local E2E.
- [x] Environment `sec-deps`; REGISTRY=local; API_PORT=9171; UI_PORT=5371; MAILDEV_UI_PORT=1271; ENV always last.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `package.json`
  - [x] `package-lock.json`
  - [x] `api/package*.json`
  - [x] `ui/package*.json`
  - [x] `packages/*/package*.json`
  - [x] `tools/*/package*.json`
  - [x] `.security/**`
  - [x] `BRANCH.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `.github/**`
  - [x] `docker-compose*.yml`
- [x] **Conditional Paths (allowed only with explicit exception)**:
  - [ ] Minimal application compile fixes strictly required by dependency upgrades.

## Feedback Loop
- [ ] Scope clarification pending: three HIGH alerts in `apps/auth-idp/web/package-lock.json` are outside the supplied scope.

## AI Flaky tests
- [x] No flaky acceptance requested; E2E runs in CI only.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: independent security lane; no merge by this agent.

## UAT Management (in orchestration context)
- [x] Dependency-only change; automated regression gates and CI qualify behavior.

## Plan / Todo (lot-based)
- [x] Lot 0 — Read rules, verify branch mechanically, inventory Dependabot, inspect audit policy and Make targets.
- [x] Lot 1 — Patch API/root dependency resolutions; reassess image-size fixes.
  - [x] Root image-size override 2.0.3; root lockfile audit has zero HIGH/CRITICAL.
  - [x] API xmldom, Hono, form-data and image-size updated; API lockfile audit has zero HIGH/CRITICAL.
  - [x] Remove both image-size allowlist entries and the five corresponding vulnerability-register records.
- [ ] Lot 2 — Patch UI dependencies including critical Vitest; update mail mock Nodemailer.
- [ ] Lot 3 — Validate existing tests without source/test changes.
  - [ ] `make typecheck-ui` and `make lint-ui`.
  - [ ] `make test-ui` (existing UI TypeScript suite).
  - [ ] `make typecheck-api` and `make lint-api`.
  - [ ] `make test-api-unit` (existing `api/tests/unit/**`).
  - [ ] Audit affected resolved trees and verify remaining exceptions.
  - [ ] `make down ENV=sec-deps`.
- [ ] Lot 4 — Scope check, atomic commits, non-draft PR with advisory table, CI logs and incremental report.
  - [ ] All CI green at final head; hand off to orchestrator without merging.
