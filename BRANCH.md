# Feature: Decision API host and authoritative remote pricing

## Objective
- [x] Integrate JEV and OpenAI Decisions into the authenticated API through cluster-mesh, with durable financial ports and fail-closed production readiness.

## Scope / Guardrails
- [x] Owner priority 2026-10-28: integrate both remote backends; local hosting remains deferred.
- [x] Base: origin/main de7ab8d31; branch feat/decision-host-h1; worktree tmp/worktrees/decision-h1.
- [x] No live provider requests, spend, deployment, PR merge, rebase, Python or AI commit trailers.
- [x] Use existing make targets; ENV=test-decision-h1 last; API_PORT=8798 UI_PORT=5198 MAILDEV_UI_PORT=1098.
- [x] Serialize Docker steps with flock; tear down the isolated environment after each step.
- [x] One additive control migration; atomic make commits at most 150 changed lines.
- [x] Qualification is host-selected and admin-only; production stays unqualified.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `.github/workflows/ci.yml`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `api/src/routes/namespaces/llm-mesh.ts`
  - `api/src/routes/namespaces/llm-mesh-cutover.ts`
  - `api/src/routes/namespaces/decision*.ts`
  - `api/src/services/decision*.ts`
  - `api/src/services/llm-metering/decision*.ts`
  - `api/src/services/llm-metering/budget-admission.ts`
  - `api/src/services/llm-metering/model-pricing-writer.ts`
  - `api/src/db/control-schema.ts`
  - `api/vitest.config.ts`
  - `api/drizzle/control/*decision*.sql`
  - `api/drizzle/control/meta/_journal.json`
  - `api/tests/unit/decision*.test.ts`
  - `api/tests/api/decision*.test.ts`
  - `api/tests/api/llm-admission-schema.test.ts`
  - `packages/llm-mesh/src/decision/descriptor.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/tests/decision-fixtures.ts`
  - `packages/llm-mesh/tests/decision-public-surface.test.ts`
  - `packages/cluster-mesh/tests/decision-receipts.spec.ts`
  - `packages/cluster-mesh/tests/fixtures/train.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `package-lock.json`
  - `spec/decision/api-host.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose.*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (BR822-EX3: Decision secret names only)
  - `docker-compose.yml` (BR822-EX3: Decision environment names only)
  - `deploy/k8s/base/30-api.yaml` (BR822-EX3: optional Decision secret references only)
  - `api/drizzle/*.sql` (maximum one migration; control uses its existing migration lane)
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare BRH-EXn with reason, impact and rollback before changing conditional paths.

## Feedback Loop
- [x] H1-R2-MERGE-2 — Main advanced during CI: merge origin/main ecca3a0d5 (PR #826), keeping this plan as the sole conflict resolution and retaining incoming DAG changes. Head 80c7183eb passed full PR CI 40774107205 and all four required checks; the new merge head must pass separately. No rebase or Track writes.
- [x] H1-R2-MERGE — Merge origin/main 8d37455df without rebase; BRANCH.md was the sole conflict and this PR's plan is retained. Incoming changes are unchanged; both parents and the merge retain identical Track files, with no Track writes.
- [x] H1-R2-F7 — Fixture dispatch always runs ci-gate and fails before checkout or artifacts with an explicit refusal; ordinary gate evaluation is unchanged. Regression reproduced the skipped gate, then all 137 Docker-hosted workflow wiring tests passed, including execution of the refusal step.
- [x] H1-R1-MERGE — Retain both manual workflow inputs, guarded inherited secrets, main's image cache configuration and the Decision plan while merging c8ec01237; no Track writes.
- [x] BR822-EX4 — Merged origin/main c8ec01237 in 93de7e1ee to resolve the workflow conflict blocking pull_request CI; no rebase. Impact: inherited reviewed CI-image changes, retained Decision guards and this plan; temporary integration allowances removed. Rollback: revert the merge. Both parent event logs retain all 370 event IDs; acceptance writes remain with the designated conductor.
