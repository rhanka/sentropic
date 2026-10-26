# Feature: V4-L3 JEV and OpenAI Decisions

## Objective
- [ ] Deliver separate native JEV and OpenAI Decisions protocols through the existing Decision mesh capability.

## Scope / Guardrails
- [x] Base: origin/main; branch: feat/decision-v4-l3; worktree: tmp/worktrees/decision-v4l3.
- [x] Make only; Docker lock on every container/test step; ENV=test-decision-v4l3 last.
- [x] Fixtures only; no paid calls, live qualification, prompted fallback or JEV upgrade.
- [x] Preserve receipt v1, custody, one attempt, deadlines, settlement and unqualified discovery.
- [x] Reserved ports if needed: API_PORT=9465 UI_PORT=5665 MAILDEV_UI_PORT=1565.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`
  - [x] `packages/llm-mesh/src/decision/**`
  - [x] `packages/llm-mesh/src/transport/openai-decisions.ts`
  - [x] `packages/llm-mesh/tests/decision-*`
  - [x] `packages/llm-mesh/tests/fixtures/decision/**`
  - [x] `packages/llm-mesh/package.json`
  - [x] `packages/llm-mesh/README.md`
  - [x] `spec/SPEC_EVOL_LLM_MESH.md`
  - [x] `spec/decision/**`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
- [x] **Conditional Paths (explicit exception required)**:
  - [x] `package-lock.json`
  - [x] `.github/workflows/**`
- [x] **Exception process**: declare reason, impact and rollback below before changes.

## Feedback Loop
- [x] BR93-EX1: synchronize only the llm-mesh workspace version in `package-lock.json` after the mandatory feature bump. Impact: one workspace metadata cell, no dependency resolution changes. Rollback: revert that cell with the package version.
- [x] OD-5 remains open; live identity, billing and calibration belong to L5/L6.

## AI Flaky tests
- [x] No live provider tests or accepted flaky failures.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; author implementation followed by independent harness review.

## UAT Management (in orchestration context)
- [x] Library-only change; fixture API and mesh integration controls replace product UI UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and scope**
  - [x] Read Docker lock, complete spec v4, Sol review, merged PR #693 and its branch plan.
  - [x] Run mechanical harness branch check before work.
- [ ] **Lot 1 — P25 JEV versioned discriminator**
  - [ ] Add failing versioned binary/choice/graded discriminator fixtures and contradiction controls.
  - [ ] Correct closed JEV codec and run scoped decision-jev-v4l3.test.ts.
- [ ] **Lot 2 — P24 separate Decisions codec**
  - [ ] Add failing native controls and independent name/count/type/refusal/usage/identity mutations in decision-openai-v4l3.test.ts.
  - [ ] Implement one-question predicate/choice/score protocol with independent usage evidence.
- [ ] **Lot 3 — Transport, registration and tariff**
  - [ ] Add fixed HTTPS Decisions transport and adapter with explicit descriptor registration.
  - [ ] Test endpoint, credentials, one attempt, no CLI route, protocol tariff collision and unqualified refusal.
  - [ ] Keep JEV baseline and OpenAI candidate report packets with source evidence and outstanding qualification.
- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update mesh README and tracked specification; record package version check/bump.
- [ ] **Lot N — Final validation**
  - [ ] Full mesh tests, mesh typecheck/lint and relevant cluster Decision tests.
  - [ ] Independent harness review; reconcile findings with tests.
  - [ ] Scope-check before every selective atomic commit under 150 lines.
  - [ ] Push and open draft PR with this plan as body and requested title.
  - [ ] Verify CI green at final head; do not merge.
- [x] Atomic artifact: test(decision): pin JEV discriminator conformance.
