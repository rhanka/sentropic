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
  - `api/drizzle/control/*decision*.sql`
  - `api/drizzle/control/meta/_journal.json`
  - `api/tests/unit/decision*.test.ts`
  - `api/tests/api/decision*.test.ts`
  - `packages/llm-mesh/src/decision/descriptor.ts`
  - `packages/llm-mesh/package.json`
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
  - [ ] Compose the Decision host lazily through cluster-mesh and add authenticated POST /api/v1/llm-mesh/decision.
  - [ ] Resolve verified workspace authorization and financial ownership outside caller JSON.
  - [ ] Reuse OPENAI_API_KEY; resolve the new JEV_API_KEY connection without logging secrets.
  - [ ] Implement durable Decision budget and receipt ports over llm-metering, including overrun disable and pending liability.
  - [x] Add control migration and schema for metadata receipts and persistent evaluator disable evidence.
  - [x] Add bounded database transactions, evaluator-first locks and owner-fenced hold/receipt persistence.
  - [x] Adapt existing all-bucket admission with pinned prices, evaluator disable checks and durable dispatch marking.
  - [x] Implement atomic Decision ledger settlement, pending-liability charges, overrun disable evidence and outbox receipts.
  - [ ] Keep production refusing; expose experimental qualification only to application admins.
  - [ ] API unit tests: api/tests/unit/decision-host.test.ts; api/tests/unit/decision-route.test.ts.
  - [ ] API integration tests: api/tests/api/decision-metering.test.ts.
- [ ] **H2 — Authoritative pricing**
  - [ ] Verify and cite the published JEV tariff at its primary source.
  - [ ] Add both immutable control.model_pricing rows using the existing control migration lane.
  - [ ] Move JEV price authority from its synthetic fixture to control.model_pricing and bump llm-mesh.
  - [ ] Test exact revision/protocol resolution and missing or stale price refusal.
- [ ] **Docs consolidation**
  - [ ] Document route, profiles, readiness limits, tariff sources and provisioned environment names in spec/decision/api-host.md.
- [ ] **Final validation**
  - [ ] Scoped fixture tests, API typecheck/lint and affected mesh checks under the Docker lock.
  - [ ] Review with two independent complementary peers and reconcile findings.
  - [ ] Inspect every diff hunk; pass make scope-check before each atomic commit.
  - [ ] Open a draft PR to main using this plan as its body and add the implementation plan comment.
  - [ ] Verify completed/success CI on the exact final head.
  - [ ] Run make down and report PR, exact head, environment variable names only.
