# Feature: Decision API host and authoritative remote pricing

## Objective
- [ ] Integrate JEV and OpenAI Decisions into the authenticated API through cluster-mesh, with durable financial ports and fail-closed production readiness.

## Scope / Guardrails
- [x] Owner priority 2026-10-28: integrate both remote backends; local hosting remains deferred.
- [x] Base: origin/main de7ab8d31; branch feat/decision-host-h1; worktree tmp/worktrees/decision-h1.
- [x] No live provider requests, spend, deployment, merge, rebase, Python or AI commit trailers.
- [x] Use existing make targets; ENV=test-decision-h1 last; API_PORT=8798 UI_PORT=5198 MAILDEV_UI_PORT=1098.
- [x] Serialize Docker steps with flock; tear down the isolated environment after each step.
- [x] One additive control migration; atomic make commits at most 150 changed lines.
- [x] Qualification is host-selected and admin-only; production stays unqualified.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/routes/namespaces/llm-mesh.ts`
  - `api/src/routes/namespaces/llm-mesh-cutover.ts`
  - `api/src/routes/namespaces/decision*.ts`
  - `api/src/services/decision*.ts`
  - `api/src/services/llm-metering/decision*.ts`
  - `api/src/db/control-schema.ts`
  - `api/vitest.config.ts`
  - `api/drizzle/control/*decision*.sql`
  - `api/drizzle/control/meta/_journal.json`
  - `api/tests/unit/decision*.test.ts`
  - `api/tests/api/decision*.test.ts`
  - `packages/llm-mesh/src/decision/descriptor.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/tests/decision-fixtures.ts`
  - `packages/llm-mesh/tests/decision-public-surface.test.ts`
  - `packages/cluster-mesh/tests/decision-receipts.spec.ts`
  - `package-lock.json`
  - `spec/decision/api-host.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (maximum one migration; control uses its existing migration lane)
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare BRH-EXn with reason, impact and rollback before changing conditional paths.

## Feedback Loop
- [x] Track source artifact only: concurrent root .track changes belong to the designated conductor.
- [ ] H1-CI-01 — Owner decision pending: the existing CI supplies live provider keys to AI API/E2E suites. Preserve no-spend with a draft CI hold until a scoped credential-free CI path is authorized; no remote CI success claimed.
- [ ] H1-REV-01 — Conductor handoff: review selection failed because discovery supplies no exact reviewer models; select two complementary host/model tuples before merge. Local dossier: root .tmp/decision-h1-review/selection.md; no consensus verdict.

## AI Flaky tests
- [x] Provider calls are forbidden in this lot; fixtures and fakes only; no flaky acceptance requested.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, sequential author commits; merge only if subsequently authorized.

## UAT Management (in orchestration context)
- [x] API-only delivery; validate authenticated HTTP behavior with fixtures in the isolated test environment.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read MASTER, workflow, spec-v4 deferred host lot, Decision ports, qualification gates and branch template.
  - [x] Create requested worktree and mechanically pass harness check branch.
  - [x] Record allowed paths, environment, ports and no-spend restriction.
- [ ] **H1 — API host junction**
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
  - [x] API integration tests: api/tests/api/decision-metering.test.ts (15 passed); api/tests/api/decision-api.test.ts (7 passed).
  - [x] Actual product composition refuses anonymous ingress, discovers both unqualified evaluators and persists production refusal without a hold or fetch.
  - [x] Recreate the disposable database and verify the exact consolidated migration hash plus tenant/workspace revocations in api/tests/api/decision-api.test.ts (7 passed).
- [ ] **H2 — Authoritative pricing**
  - [x] Verify and cite the published JEV tariff at its primary source.
  - [x] Add both immutable control.model_pricing rows using the existing control migration lane.
  - [x] Move JEV price authority from its synthetic fixture to control.model_pricing and bump llm-mesh to 0.31.1 (npm view: 0.31.0).
  - [x] Add PostgreSQL tests for exact revision/protocol prices, missing prices and one metadata-only settlement per backend.
  - [x] Extend the existing ledger operation CHECK to decision; real-PG regression reproduced the prior constraint refusal.
  - [x] Add all-bucket cap, pending-liability and durable overrun-disable regression controls; bind dispatch to the held evaluator.
  - [x] Readiness checks credentials, the tenant's strategy/bucket and each evaluator's durable disable state.
  - [x] Reaper reconciliation restores Decision attribution and corrects conservative spend once without provider replay.
  - [x] Align the existing public-surface release assertion with the required 0.31.1 patch bump.
  - [x] Keep the cluster-mesh receipt fixture's synthetic price protocol explicit after JEV moves to control pricing.
  - [x] Serialize pricing with its existing writer, pin the exact hold revision and recheck tariff validity before dispatch marking.
  - [x] Preserve pending admission liability when a hold commits but its acknowledgement is lost; never report a proved absence of a hold on a store exception.
- [x] **Docs consolidation**
  - [x] Document route, profiles, readiness limits, tariff sources and provisioned environment names in spec/decision/api-host.md.
- [ ] **Final validation**
  - [ ] Scoped fixture tests, API typecheck/lint and affected mesh checks under the Docker lock.
  - [x] llm-mesh: 1,529 tests passed; cluster-mesh Decision composition/receipts: 9 tests passed.
  - [x] API unit host/HTTP: 16 tests passed; actual API/migration/revocation: 7 tests passed.
  - [ ] Review with two independent complementary peers and reconcile findings.
  - [ ] Inspect every diff hunk; pass make scope-check before each atomic commit.
  - [ ] Open a draft PR to main using this plan as its body and add the implementation plan comment.
  - [ ] Verify completed/success CI on the exact final head.
  - [ ] Run make down and report PR, exact head, environment variable names only.
