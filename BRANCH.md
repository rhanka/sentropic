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
  - [x] `packages/cluster-mesh/src/modules/catalog.ts`
  - [x] `packages/cluster-mesh/package.json`
  - [x] `packages/cluster-mesh/tests/**`
  - [x] `packages/llm-gateway/package.json`
  - [x] `scripts/ci/publishable-ci-wiring.test.mjs`
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
- [x] CI-LIVE — conductor decision B-lite (2026-10-26): open the draft PR with existing provider-backed CI under the owner's current budget. Added tests use fixtures and recorded answers only; no new live-call job or offline-CI profile is introduced.
- [ ] REVIEW — attention: exact complementary reviewers not selected; no independent code-review consensus is claimed. Author handoff is ready for the conductor.
- [x] P24 dated GA schema: require cache/reasoning objects; invalid usage counters remain non-billable pending reconciliation, while independently valid usage survives answer refusals.
- [x] BR93-EX2: mesh 0.29.0 is rejected by cluster's current <0.29.0 bound. Extend only mesh compatibility to <0.30.0, gateway mesh dependency and exact fixture/CI tuple; patch-bump the affected metadata/source packages. Impact: admits the tested native Decisions minor via the existing loader. Rollback: revert tuple/range cells together. Conditional `.github/workflows/ci.yml` changes are limited to its three exact PEERS tuples.
- [x] BR93-EX1: synchronize five `package-lock.json` workspace cells: llm-mesh version 0.29.0 for the native Decisions feature; cluster-mesh version 0.22.5 for its loader compatibility change; cluster-mesh llm-mesh peer range <0.30.0 to admit that feature; llm-gateway version 0.21.4 for its compatibility metadata change; llm-gateway llm-mesh dependency range adding ^0.29.0 to consume that feature (BR93-EX2). Impact: five metadata cells, no resolved dependency/integrity changes. Rollback: revert all five cells together with the corresponding package versions/ranges and BR93-EX2 tuple.
- [x] Opus r1 P2-1/P2-2: add service controls for contradictory cached input and paid cache writes retaining the reserve without settle/release; test the shipped unqualified descriptor through service and direct adapter before egress; correct BR93-EX1.
- [x] OD-5 remains open; live identity, billing and calibration belong to L5/L6.

## Deferred to BR-7x
- [ ] CI train owner: evaluate local proposal `tmp/decision-v4l3-offline-ci.patch`; retain the file unapplied and uncommitted. Acceptance: an independently reviewed offline CI profile with its own train validation; no profile workflow change in V4-L3.

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
- [x] **Lot 1 — P25 JEV versioned discriminator**
  - [x] Add failing versioned binary/choice/graded discriminator fixtures and contradiction controls.
  - [x] Correct closed JEV codec and run scoped decision-jev-v4l3.test.ts; require discriminator on provider responses.
- [x] **Lot 2 — P24 separate Decisions codec**
  - [x] Add failing native controls and independent name/count/type/refusal/usage/identity mutations in decision-openai-v4l3.test.ts.
  - [x] Implement one-question predicate/choice/score protocol with independent usage evidence.
- [x] **Lot 3 — Transport, registration and tariff**
  - [x] Add fixed HTTPS Decisions transport and adapter with explicit descriptor registration.
  - [x] Test endpoint, credentials, one attempt, no CLI route, protocol tariff collision and unqualified refusal.
  - [x] Keep JEV baseline and OpenAI candidate report packets with source evidence and outstanding qualification.
  - [x] Test mesh 0.29 admission, update cluster/gateway compatibility metadata and verify packed tuple (107 packed tests passed).
- [x] **Lot N-1 — Docs consolidation**
  - [x] Update mesh README and tracked specification; registry baseline mesh 0.28.1/gateway 0.21.3/cluster 0.22.4; candidates 0.29.0/0.21.4/0.22.5.
- [ ] **Lot N — Final validation**
  - [x] Opus r1 correction: both usage contradictions reproduced at cost 100/settled before the fix; 54 scoped OpenAI tests passed afterward. Full mesh: 1445 passed across 80 files; mesh typecheck/lint passed on ENV=test-decision-v4l3.
  - [x] Full cluster: 1144 passed/129 conventionally skipped; cluster typecheck/lint passed; packed consumer 107/15 passed; train lock integrity passed for published baselines, native candidates remain unpublished.
  - [x] Source qualification head 1f4ed952d: verified sibling receipts; mesh archive SHA256 fd8a63feae824e3dc0800aa926ff64749681e4191b43391f906ac0da2dea342e. Preserve the published artifacts 0.1.4 lock baseline.
  - [x] CI wiring tests: 24 passed; memory-l5-verify: 30 files/54 edges, unchanged retained manifest.
  - [ ] Independent harness review; reconcile findings with tests.
  - [x] Scope-check before every selective atomic commit under 150 lines.
  - [x] Draft PR #772 opened; retain draft status during author corrections.
  - [ ] Verify CI green at final head; do not merge.
- [x] Atomic artifact: test(decision): pin JEV discriminator conformance.
- [x] Atomic artifact: test(decision): specify native Decisions wire refusals.
- [x] Atomic artifact: test(decision): cover native route and tariff admission.
- [x] Atomic artifact: test(decision): bound dedicated Decisions transport.
- [x] Atomic artifact: feat(decision): declare native Decisions candidate and request.
- [x] Atomic artifact: feat(decision): decode typed Decisions answers and usage.
- [x] Atomic artifact: feat(decision): add fixed bounded Decisions HTTP transport.
- [x] Atomic artifact: feat(decision): register native OpenAI adapter and credentials.
- [x] Atomic artifact: feat(decision): bind native host validation and service tariff.
- [x] Atomic artifact: docs(decision): publish V4-L3 contracts and candidate packet.
- [x] Atomic artifact: fix(decision): require JEV wire discriminators and retain identity liability.
- [x] Atomic artifact: fix(cluster-mesh): admit the native Decisions feature tuple.
