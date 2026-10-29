# Feature: Prepare hardened Trivy image lane (S2b option B)

## Objective
- [ ] Prepare upstream Trivy by immutable image digest with trusted DB acquisition and fail-closed execution; qualification and daily activation remain blocked.

## Scope / Guardrails
- [x] Owner-authorized default B from dossier r2, SHA-256 b4de75e7 prefix; no toolbox Dockerfile change.
- [x] Branch `feat/sec-s2b-trivy-b` from `origin/main` at `213638676`; isolated worktree `tmp/worktrees/sec-s2b`.
- [x] Make only; zero Python; selective staging; commits at most 150 changed lines without AI trailers; merge updates only.
- [x] Docker uses the shared `.tmp/packets/DOCKER-LOCK.md` flock and scoped teardown; `ENV=test-sec-s2b` always last.
- [x] Fixture containers bind no ports; reserved API/UI/Maildev ports 9410/5610/1510 remain unused.
- [x] Preserve disabled auto-fix, S2c/S3 and all missing S2b evidence; no schedule, publisher, credentials or merge actor.
- [x] Keep source, target and DB isolated from the scanner; no host Docker socket or credential mounts in scanner execution.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `.security/trivy-toolchain.json`
  - `scripts/security/daily/toolchain*.mjs`
  - `scripts/security/daily/trivy*.mjs`
  - `scripts/security/daily/scan.mjs`
  - `scripts/security/daily/scan.test.mjs`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `docs/security/trivy-s2b.md`
  - `Makefile`
- **Forbidden Paths (must not change in this branch)**:
  - `api/Dockerfile`
  - `ui/Dockerfile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.security/security-fix.json`
  - `.security/vulnerability-register.yaml`
  - `packages/**`
  - `.track/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (SECDAILY-EX1, daily Trivy preparation/test recipes only)
- **Exception process**:
  - [x] Declare additional exceptions with reason, impact and rollback before editing.

## Feedback Loop
- [x] SECDAILY-EX1: approved plan permits daily scanner pin/isolation recipes. Impact limited to preparation and fixture targets; rollback removes those targets and retains S2a blocked state. Toolbox exception is not opened.
- [ ] S2B-Q1, conductor, blocked: verifier admission, publisher identity/signature receipt and content review of exact index/platform pins.
- [ ] S2B-Q2, conductor, blocked: live DB provenance/integrity/freshness, Java/IaC data, immutable targets with exact source/platform, zero-Python runtime inventory.
- [x] BR822-EX3 — Owner-requested Decision provisioning in Compose, k8s-bundle-secret and the API env template. Impact: pass JEV_API_KEY and DECISION_EXECUTION_PROFILE by name only; missing values stay unavailable, production refuses; no deployment or credential provisioning. Rollback: remove these two entries/references from each surface.
- [x] H1-R1-F2 — Exclude fixture dispatch from deployment, release verification and inherited secrets; main dispatch regression reproduced deployment access, then all 135 workflow wiring tests passed without weakening ordinary gates.
- [x] H1-R1-F5 — Compose and Kubernetes pass Decision names only, with optional secret references and no activation default; all 136 workflow/provisioning tests passed, including fail-closed wiring assertions.
- [ ] H1-R1-F1 — Push corrections and complete full pull_request CI with successful ci-gate on the exact final head; fixture-only success is insufficient.
- [x] Track source artifact only: concurrent root .track changes belong to the designated conductor.
- [x] H1-CI-01 — Fixture-only run 40729849776 passed; full PR CI is required separately by H1-R1-F1.
- [x] H1-CI-02 — The fixture job cannot authenticate canonical registry-tag reuse. Use the official build-api-image-fresh target for its intentional local production build; the API checks and 146 fixture tests passed before that build in run 40724315953.
- [x] H1-CI-03 — The cluster runner accepts one literal filter; tests/decision- selects both fixture files (9 tests passed locally). Run 40726186707 passed API checks, production build and llm-mesh before rejecting the prior two-path filter.
- [x] BRH-EX1 — Add an explicit manual fixture-only mode to .github/workflows/ci.yml to fulfill the requested no-spend CI. Impact: dedicated API/mesh checks with no publication; ordinary PR/main runs unchanged. Rollback: remove that input, job and mode guards.
- [x] BRH-EX2 — Merge origin/main 5e986a0b6 without rebase; retain the H1/H2 plan and incoming speech/release changes unchanged. Temporary merge-only allowances removed after fc2e12047; authored scope passed separately against the second parent. Rollback: revert the merge. Both parent event logs retain all 370 event IDs; Track acceptance remains with its designated conductor.
- [ ] H1-REV-01 — Conductor handoff: review selection failed because discovery supplies no exact reviewer models; select two complementary host/model tuples before merge. Local dossier: root .tmp/decision-h1-review/selection.md; no consensus verdict.

## AI Flaky tests
- [x] Provider calls are forbidden in this lot; fixtures and fakes only; no flaky acceptance requested.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, sequential author commits; PR merge only if subsequently authorized.

## UAT Management (in orchestration context)
- [x] API-only delivery; validate authenticated HTTP behavior with fixtures in the isolated test environment.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read MASTER, workflow, spec-v4 deferred host lot, Decision ports, qualification gates and branch template.
  - [x] Create requested worktree and mechanically pass harness check branch.
  - [x] Record allowed paths, environment, ports and no-spend restriction.
- [x] **H1 — API host junction**
  - [x] Compose the Decision host lazily through cluster-mesh and add authenticated POST /api/v1/llm-mesh/decision.
  - [x] Resolve verified workspace authorization and financial ownership outside caller JSON.
  - [x] Reuse OPENAI_API_KEY; resolve the new JEV_API_KEY connection without logging secrets.
  - [x] Implement durable Decision budget and receipt ports over llm-metering, including overrun disable and pending liability.
  - [x] Add control migration and schema for metadata receipts and persistent evaluator disable evidence.
  - [x] Add bounded database transactions, evaluator-first locks and owner-fenced hold/receipt persistence.
  - [x] Adapt existing all-bucket admission with pinned prices, evaluator disable checks and durable dispatch marking.
  - [x] Implement atomic Decision ledger settlement, pending-liability charges, overrun disable evidence and outbox receipts.
  - [x] Compose both remote adapters, explicit profiles, environment auth and protocol-bound authoritative pricing ports.
  - [x] Add bounded HTTP parsing and trusted workspace/tenant resolution with authorization repeated before dispatch.
  - [x] Keep production refusing; expose experimental qualification only to application admins.
  - [x] API unit tests: api/tests/unit/decision-host.test.ts; api/tests/unit/decision-route.test.ts (16 passed).
  - [x] Add no-spend host tests for both backends, production refusal, missing credentials, authorization, price and input limits.
  - [x] Host fixture gate: 9 tests passed; align the typed PostgreSQL hold projection with Drizzle's row contract.
  - [x] Add HTTP controls for authentication, qualification admin restrictions, workspace refusal, outages and bounded bodies.
  - [x] API integration tests: api/tests/api/decision-metering.test.ts (17 passed); api/tests/api/decision-api.test.ts (7 passed).
  - [x] Actual product composition refuses anonymous ingress, discovers both unqualified evaluators and persists production refusal without a hold or fetch.
  - [x] Recreate the disposable database and verify the exact consolidated migration hash plus tenant/workspace revocations in api/tests/api/decision-api.test.ts (7 passed).
- [x] **H2 — Authoritative pricing**
  - [x] Verify and cite the published JEV tariff at its primary source.
  - [x] Add both immutable control.model_pricing rows using the existing control migration lane.
  - [x] Move JEV price authority from its synthetic fixture to control.model_pricing and bump llm-mesh to 0.31.1 (npm view: 0.31.0).
  - [x] After merging main's 0.32.0, advance the patch tuple to 0.32.1; Docker-hosted npm view still reports 0.31.0 before the bump.
  - [x] Add PostgreSQL tests for exact revision/protocol prices, missing prices and one metadata-only settlement per backend.
  - [x] Extend the existing ledger operation CHECK to decision; real-PG regression reproduced the prior constraint refusal.
  - [x] Add all-bucket cap, pending-liability and durable overrun-disable regression controls; bind dispatch to the held evaluator.
  - [x] Readiness checks credentials, the tenant's strategy/bucket and each evaluator's durable disable state.
  - [x] Reaper reconciliation restores Decision attribution and corrects conservative spend once without provider replay.
  - [x] Align the existing public-surface release assertion with the required 0.31.1 patch bump.
  - [x] Keep the cluster-mesh receipt fixture's synthetic price protocol explicit after JEV moves to control pricing.
  - [x] Serialize pricing with its existing writer, pin the exact hold revision and recheck tariff validity before dispatch marking.
  - [x] Preserve pending admission liability when a hold commits but its acknowledgement is lost; never report a proved absence of a hold on a store exception.
  - [x] Scope pricing windows by protocol so OpenAI Decisions never replaces the existing GPT-6 Luna generation tariff.
  - [x] Verify native and generation prices coexist at one timestamp in api/tests/api/decision-metering.test.ts (17 passed); schema upgrade/restore and expanded Decision operation (20 passed).
  - [x] Run api/tests/api/llm-budget-ledger.test.ts (38 passed) and api/tests/unit/llm-budget-admission-native.test.ts (26 passed) after the protocol-specific pricing change.
- [x] **Docs consolidation**
  - [x] Document route, profiles, readiness limits, tariff sources and provisioned environment names in spec/decision/api-host.md.
- [ ] **Final validation**
  - [x] After merging main, 146 scoped API tests passed in one run, including tests/unit/gateway-package-version.test.ts; API typecheck/lint passed.
  - [x] llm-mesh public package/consumer surface: 4 tests passed with the final 0.32.1 tuple.
  - [x] llm-mesh: 1,566 tests passed after merging main; cluster-mesh Decision composition/receipts: 9 tests passed with the corrected runner filter.
  - [x] API unit host/HTTP: 16 tests passed; actual API/migration/revocation: 7 tests passed.
  - [ ] Review with two independent complementary peers and reconcile findings.
  - [x] Inspect every diff hunk; pass make scope-check before each atomic commit.
  - [x] Open draft PR #822 to main using this plan as its body and add the implementation plan comment.
  - [ ] Verify completed/success CI on the exact final head.
  - [x] Add and run the explicit manual Decision fixture workflow mode; distinguish it from ordinary live-suite acceptance.
  - [x] Local Docker stack torn down after validation; runtime health logs contain no errors.
  - [x] Retain CI selection/publication safeguards: 135 wiring tests, 23 expected-result tests and ci-capacity-policy passed.
  - [ ] Run make down and report PR, exact head, environment variable names only.
