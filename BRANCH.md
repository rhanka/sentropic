# Feature: W4.b authorized host registry catalog source

## Objective
- [ ] Project the single compiled app registry into the existing catalog and delegate authorized calls to the existing artifact transport.

## Scope / Guardrails
- [x] Owner deliverable 2, plan-v2.md W4.b line 147 and sections 2–5; dependencies W2.a and W4.a merged in base `21bf636d9`.
- [x] Branch `feat/app-cm-w4b`, worktree `tmp/worktrees/app-w4b`, draft PR base `feat/app-cm-integration`; merge only, never rebase or force-push.
- [x] Tests first; selective staging, scope-check and make commit below 150 lines; no attribution trailers.
- [x] Dedicated ports API_PORT=8802 UI_PORT=5188 MAILDEV_UI_PORT=1095; ENV=test-app-w4b last on every make.
- [x] Build/start/test commands use shared Docker flock; down after each step; no production activation, ENV=dev, clean-all or Python.
- [x] Preserve package ownership, locks, migrations and APP-P1 selection; no second catalog, mutation dispatcher or MCP name sanitizer.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/catalog/sources/host-registry-source.ts`
  - `api/src/services/catalog/request-authority.ts`
  - `api/src/services/skills/catalog.ts`
  - `api/src/services/artifacts/credentials.ts`
  - `api/tests/services/catalog/host-registry-source.spec.ts`
  - `api/tests/api/cluster-mesh-catalog.test.ts`
  - `api/tests/api/artifacts-host-credentials.test.ts`
  - `.github/workflows/app-cm-w4b.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `api/drizzle/**`
  - `deploy/**`
  - `package*.json`
  - `api/package*.json`
  - `plan/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- [x] Record rationale, impact and rollback in Feedback Loop before expansion.

## Feedback Loop
- [x] BR-W4B-EX1: integration PRs do not trigger ci.yml. Add branch-specific exact-head qualification using existing make targets and teardown, without publication/deployment. Rollback removes workflow.
- [x] Turn execution must retain conversation authority through the final host transaction. Extend only the existing credential reader with a workspace-bound turn credential; host authorization remains the sole effect guard. Rollback removes credential kind and source wiring.

## AI Flaky tests
- [x] No AI-dependent acceptance or timeout increases.

## Orchestration Mode (AI-selected)
- [x] Mono-branch author; independent final reviews use read-only peers.

## UAT Management (in orchestration context)
- [x] Backend catalog only; automated HTTP discovery and model/executor acceptance; no root-dev or production UAT.

## Plan / Todo (lot-based)
- [x] Lot 0 — Read rules, template, W4.b row and cited sections; create assigned worktree; mechanical branch check passes.
- [ ] Lot 1 — Tests authored first in `api/tests/services/catalog/host-registry-source.spec.ts`: exact names/schema, denied contexts, read-only, interleaved views, filtering before ranking/serialization and one execution; initial run pending stack readiness.
- [ ] Lot 2 — Implement source; register once in `skills/catalog.ts`; await public compiled plan in `request-authority.ts`; no private cache.
- [ ] Lot 3 — Tests first in `artifacts-host-credentials.test.ts` for workspace-bound turn and revocation; extend existing credential reader.
- [ ] Lot 4 — Extend `cluster-mesh-catalog.test.ts`: mounted discovery, model/executor, durable single effect and revocation; preserve HTTP/MCP regressions.
- [ ] Lot 5 — Scoped catalog/registry/transport/credential suites, API typecheck/lint, logs and down; exact-head CI workflow; reconcile independent reviews.
- [ ] Lot 6 — Scope-check each commit, push, draft PR from this file and first plan comment; CI green on reported head; no merge or activation.
