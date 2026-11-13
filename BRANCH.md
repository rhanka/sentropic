# Feature: Opt-in Gemini Decisions capability

## Objective
- [ ] Integrate gemini-decision-1 through the existing host decision service without default egress.

## Scope / Guardrails
- [x] Branch feat/llm-mesh-gemini-decisions, isolated worktree tmp/worktrees/gemini-decisions.
- [x] Make-only, Docker-first; ENV=test-gemini-decisions last; no live calls or secrets in evidence.
- [x] No services needed; reserved API 9702, UI 5902, Maildev 1802.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/**`
  - `BRANCH.md`
  - `package-lock.json`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/tests/modules/registry.spec.ts`
  - `packages/cluster-mesh/tests/modules/topology-ranges.spec.ts`
  - `packages/cluster-mesh/tests/packaging/tuple-skew.spec.ts`
  - `packages/cluster-mesh/tests/packaging/optional-install.spec.ts`
  - `packages/llm-gateway/package.json`
  - `packages/cluster-mesh/tests/fixtures/train.ts`
  - `packages/cluster-mesh/tests/speech-peer.spec.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.spec.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `api/tests/unit/gateway-package-version.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/**`

## Feedback Loop
- [x] BRGD-EX4: carry the CI alignment proven on green #1013 forward to the approved Gemini tuple. Rationale: source and packed tests independently assert exact versions/ranges and verified fixture archives. Impact: train/speech/skew test literals, selected fixture tuple maps and archive integrity, API gateway expectation 0.23.2. Rollback: revert the RUN 3 alignment and EX3 commits. Assertions, gates and workflows stay intact.
- [x] RUN 3 sequencing: rebased onto #1013 exact green head d83b08139 after run 43335882870 completed success (103 jobs). Ember catalog, council exclusion and CI alignment are inherited. Published versions after rebase: mesh 0.36.0, gateway 0.23.0, cluster 0.25.0, all below the proposed tuple.
- [x] BRGD-EX3: owner-approved RUN 3 minimal release/runtime extension. Rationale: published gateway dependency-map guard and cluster runtime ceiling block CI. Impact: gateway 0.23.2, cluster 0.26.0-dev.26, matching root lock workspace versions, text/speech ceilings <0.39.0, and the four range regression tests listed above. Rollback: revert the RUN 3 extension commits; no gate or workflow change.
- [ ] RUN 3: verify focused cluster range tests, strict lock, candidate guard and full CI on the exact head.
- [x] BRGD-EX2: owner-approved consumer range exception (RUN 2). Rationale: the llm-mesh minor version bump requires compatible consumer ranges. Impact: only the cluster-mesh peer field, llm-gateway dependency field and root lock. Rollback: revert this commit.
- [x] RUN 2: rebase onto origin/main required no replay; published llm-mesh remains 0.36.0, below this branch version. Candidate lock changes exactly two consumer range cells; strict npm ci --ignore-scripts --dry-run passed without force or legacy-peer-deps.
- [x] RUN 2: README confirms API keys only, no consumer OAuth/agy, no default or fallback, and immo preprod/production remains disabled; routing tests pass 12/12, including four OAuth credential rejection cases before egress.
- [x] Official announcement: https://blog.google/innovation-and-ai/technology/developers-tools/gemini-decisions-api/
- [x] Official REST request/response reference: https://aistudio.google.com/docs/decisions-api#request
- [x] ai.google.dev/api/decisions is unavailable; the announcement links to AI Studio documentation.
- [x] Google AI Studio has no Canadian residency guarantee; opt-in by exact evaluator only.
- [x] Documented responses omit served model identity. Preserve the existing identity gate and ship unqualified; never infer served identity from the request.
- [x] Track import reserved for the designated conductor; this plan is the source artifact.
- [x] BRGD-EX1: synchronize only the root lock's llm-mesh workspace version; required by the CI changes gate after a mandatory package bump. No dependency graph change; rollback restores the previous version cell.

## AI Flaky tests
- [x] Mocked transport only.

## Orchestration Mode
- [x] Mono-branch; separate from Muse because total scope exceeds 15 files.

## UAT Management (in orchestration context)
- [x] No UI surface; host routing tests qualify behavior.

## Plan / Todo (lot-based)
- [x] Lot 0: inspect official schema and existing native decision contracts.
- [x] Lot 1: descriptor, codec and bounded transport; one question per existing DecisionRequest.
  - [x] Bounded v1beta transport, API-key header, deadlines and redirects refused.
  - [x] Native question and usage mapping; binary confidence validated then projected to P(true).
- [x] Lot 2: adapter, host exports, credential restriction, pricing and reconstruction.
- [x] Lot 3: mocked routing, schema/error/deadline tests and residency documentation.
- [ ] Lot 4: version 0.38.0, scoped checks, independent review and PR CI green.
  - [x] Published npm version checked: 0.36.0; candidate 0.38.0 is greater.
  - [x] make test-llm-mesh SCOPE=tests/decision- ENV=test-gemini-decisions: 39 files, 642 tests passed.
  - [x] make typecheck-llm-mesh ENV=test-gemini-decisions: passed.
  - [x] make lint-llm-mesh ENV=test-gemini-decisions: passed.
  - [x] make scope-check ENV=test-llm-judge: PASS C2.
  - [ ] Independent Muse review dispatched after Argon account failure.
