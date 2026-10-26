# Feature: V4-L5 qualification and calibration gates

## Objective
- [ ] Enforce criterion-specific production readiness and reproducible recorded assessment validation (P22/P27/P29-P31).

## Scope / Guardrails
- [x] Base: origin/feat/decision-v4-l3; branch: feat/decision-v4-l5; worktree: tmp/worktrees/decision-v4l5.
- [x] Make only; Docker lock on every container/test step; ENV=test-decision-v4l5 last; no Python.
- [x] Fixtures only; no paid calls, live qualification, prompted fallback or JEV upgrade.
- [x] Preserve receipt v1, custody, one attempt, deadlines, settlement and unqualified discovery.
- [x] Reserved ports if needed: API_PORT=9475 UI_PORT=5675 MAILDEV_UI_PORT=1575.
- [x] Draft PR targets main and stacks on L3 PR #772; merge updates only, never rebase; do not merge.

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
  - [x] `packages/cluster-mesh/src/modules/catalog.ts`
  - [x] `packages/cluster-mesh/package.json`
  - [x] `packages/cluster-mesh/tests/**`
  - [x] `packages/llm-gateway/package.json`
  - [x] `scripts/ci/publishable-ci-wiring.test.mjs`
  - [x] `scripts/ci/ci-expected-results.test.mjs`
  - [x] `packages/cluster-mesh/tests/packaging/skew-invariants.ts`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
- [x] **Conditional Paths (explicit exception required)**:
  - [x] `package-lock.json`
  - [x] `.github/workflows/**`
- [x] **Exception process**: declare reason, impact and rollback below before changes.

## Feedback Loop
- [x] BR95-EX1: synchronize package-lock workspace metadata and cluster/gateway compatibility with the L5 feature version; rollback the tuple together; no resolved dependency changes.
- [x] BR95-EX2: CI edits limited to the release tuple; remove branch-name test exclusions per owner review, restoring API, browser E2E and VSCode gates. Earlier skips constrained provider/runtime work; existing CI gates must run.
- [x] R1 P1-2: remove the branch-named CI bypass and assert selection of every API/E2E matrix member for global changes.
- [x] R1 P1-1: distinguish experimental verdicts, mark qualification results and persisted receipts, flag provisional served identity; production validation rejects them.
- [x] R1 P2-3: identity independently denies discovery and admission; production controls retain custody, one attempt, settlement and deadline refusal.
- [x] R1 P2-1: snapshot readiness once per service and memoize deterministic assessments by record index and exact scope digest; price and admission remain live gates.
- [x] P22: test reproduced two rounded micro-USD for combined sub-micro input/output work; round the per-receipt sum once, preserving v1 accounting sources and conservative unknown-usage reserves.
- [x] Final mesh: 1485 tests / 86 files, typecheck and lint passed; CI selection/wiring: 40 tests passed. Cluster fixtures explicitly use the experimental profile; next-minor refusal assertions follow the new compatibility bound.
- [ ] REVIEW: independent complementary review availability must be recorded; no consensus without two completed eligible legs.

## AI Flaky tests
- [x] No live provider tests or accepted flaky failures.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; author implementation followed by independent harness review.

## UAT Management (in orchestration context)
- [x] Library-only change; fixture API and mesh integration controls replace product UI UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and scope**
  - [x] Read Docker lock, spec v4 sections 3/7/8/9, rules and branch template; retain receipt v1.
  - [x] Run mechanical harness branch check before work.
- [x] **Lot 1 — Discovery and isolated qualification**
  - [x] Tests first: decision-qualification.test.ts, independent missing gates and execution/criterion/policy mutations; initial run rejects missing implementation.
  - [x] Bind evidence to execution digest, exact criterion and operating policy; scope mutation controls pass.
  - [x] Qualification accepts provisional expected IDs while preserving auth, finite bounds, one attempt and experimental discovery.
  - [x] Scoped discovery/admission gates pass; source typecheck and lint pass; full mesh baseline 1472 tests passes.
- [x] **Lot 2 — Reproducible assessment**
  - [x] Tests first: decision-assessment.test.ts and recorded fixtures; all 10 initial assessment controls pass.
  - [x] Deterministic assessment/report schema with distinct held-out/challenge/repeat populations and conservative attempt/cost aggregation.
  - [x] Cap exhaustion and missing evidence produce incomplete/blocked reports; fixtures never establish semantic calibration.
  - [x] Scoped assessment controls pass; recording tests validate receipt projections, independent work counts and pre-dispatch cap stops.
- [x] **Lot N-1 — Docs consolidation**
  - [x] Public exports, README, tracked mesh spec and L6 report/run-packet needs; feature tuple mesh 0.30.0 / gateway 0.21.5 / cluster 0.22.6.
- [ ] **Lot N — Final validation**
  - [ ] Full mesh tests, typecheck, lint, build/pack; cluster compatibility and packed consumer gates; no product UI changes.
  - [ ] UAT: recorded production refusal and experimental qualification controls; web/Chrome/VSCode unaffected.
  - [ ] Independent harness review; reconcile verified findings.
  - [x] Scope-check before every selective atomic commit under 150 lines.
  - [ ] Push and open draft PR to main, explicitly stacked on #772, BRANCH.md body and plan comment.
  - [ ] Verify CI green at final head; do not merge.
