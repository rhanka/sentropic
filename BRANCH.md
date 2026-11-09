# Feature: Ops job-failure notification L1

## Objective
Generic platform job-failure email alerting: frozen OpsJobFailureV1 contract, pure incident state machine, product-key recipients, service-authenticated ingestion, TEM delivery, delivery audit.

## Scope / Guardrails
- Scope limited to Lot L1 of .tmp/rv/job-failure-plan (cluster-mesh notifications capability + api ingestion + delivery).
- One migration max in api/drizzle/control (single new file).
- Make-only workflow, no direct Docker commands, Docker via docker-slot.sh in foreground.
- Root workspace ~/src/sentropic reserved for user dev/UAT (ENV=dev) and must remain stable.
- Branch development in isolated worktree tmp/worktrees/notify-l1 (branch feat/ops-job-failure-notify-l1 from origin/main).
- Automated test campaigns on ENV=test-notify-l1, never on root dev.
- UAT qualification worktree must be commit-identical to the branch under qualification (same HEAD SHA).
- In every make command, ENV=test-notify-l1 passed as the last argument.
- All new text in English.
- Ports: API_PORT=8927 UI_PORT=5327 MAILDEV_UI_PORT=1227.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.
- Owner decision (binding): v1 sends ALL alerts to ALL admins of the target, no tech/functional split.
- Recipients via RecipientsPort keyed by product targetKey (from sentropic.io/target label), v1 backed by validated platform declaration, never hardcoded emails.
- No secret/PII in logs beyond what the mail needs.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/src/notifications/**`
  - `packages/cluster-mesh/src/modules/contracts.ts`
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/src/loaders/notifications/**`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/tests/notifications-*.spec.ts`
  - `api/src/db/control-schema.ts`
  - `api/drizzle/control/0023_ops_job_failure_notify.sql`
  - `api/drizzle/control/meta/_journal.json`
  - `api/src/services/notifications/**`
  - `api/src/routes/ops-job-failures.ts`
  - `api/src/app.ts`
  - `api/src/index.ts`
  - `api/src/config/env.ts`
  - `api/vitest.config.ts`
  - `api/tests/unit/notifications/**`
  - `api/tests/api/ops-job-failures.test.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file, public stream: NOT used, control stream file listed above instead)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `attention`: cluster-mesh version bump left to the release-train integration lane (OPTIM wagon rule, no train-owned bump in-lane)
- `attention`: enforce-package-bump may flag packages/cluster-mesh until the train assigns the version

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single L1 capability, one lane, one test cycle

## UAT Management (in orchestration context)
- [ ] **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in L1 (email-only channel), no UAT lot.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, plan, k8s answers packet.
  - [x] Create isolated worktree tmp/worktrees/notify-l1 on feat/ops-job-failure-notify-l1 from origin/main.
  - [x] Verify plan surfaces exist (modules, identity-contracts, scw-tem-client, ci-lockfile-policy).
  - [x] Define environment ENV=test-notify-l1 and ports API_PORT=8927 UI_PORT=5327 MAILDEV_UI_PORT=1227.
  - [x] Confirm command style: docker-slot.sh make ... ENV=test-notify-l1 with ENV last.
  - [x] Confirm scope and guardrails.
- [ ] **Lot 1 — cluster-mesh notifications capability**
  - [x] Frozen OpsJobFailureV1 contract + validation (targetKey product key, eventId dedup, 1 KiB detail cap, untrusted-string handling).
  - [x] Pure incident state machine (firing/digest/escalation/resolved, anti-flap 1h, cap 10/h/target, dead-man stale).
  - [x] RecipientsPort (admins of target X) + validated platform-declared v1 resolver.
  - [ ] Module registration (modules/contracts.ts, modules/catalog.ts, loaders, package export).
  - [ ] Lot gate:
    - [ ] `make typecheck-cluster-mesh ENV=test-notify-l1`
    - [ ] `make lint-cluster-mesh ENV=test-notify-l1`
    - [ ] **API tests**
      - [ ] n/a (no api change in this lot)
    - [ ] **UI tests (TypeScript only)**
      - [ ] n/a (no UI in L1)
    - [ ] **E2E tests**
      - [ ] n/a (no E2E in L1)
    - [ ] Scoped cluster-mesh suite: `make test-cluster-mesh SCOPE=tests/notifications ENV=test-notify-l1`
- [ ] **Lot 2 — api ingestion + delivery + audit**
  - [ ] control-schema.ts tables (ops_incidents, notification_deliveries, ops_seen_events).
  - [ ] ONE control migration file 0023 via make db-generate-control.
  - [ ] Ingest service (validate, upsert incident, outbox append, idempotent replay).
  - [ ] TEM adapter on sendTransactionalEmail (escaped HTML, error mapping).
  - [ ] Recipients binding (declared declaration + admin_app fallback, account-exists-and-active validation).
  - [ ] Send sweep (pending claim, per-send resolution, cap suppression, digest/escalation/dead-man due, retry-then-failed).
  - [ ] Service-authenticated ingestion route + app/index wiring + env declaration.
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-notify-l1`
    - [ ] `make lint-api ENV=test-notify-l1`
    - [ ] **API tests**
      - [ ] Add api/tests/unit/notifications/ops-tem-adapter.test.ts
      - [ ] Add api/tests/unit/notifications/ops-recipients-binding.test.ts
      - [ ] Add api/tests/api/ops-job-failures.test.ts (ingest, replay, incident, delivery rows)
      - [ ] Scoped runs: `make test-api-unit SCOPE=tests/unit/notifications ENV=test-notify-l1`
    - [ ] **UI tests (TypeScript only)**
      - [ ] n/a
    - [ ] **E2E tests**
      - [ ] n/a
- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Record ingestion contract in .tmp/rv/notify-l1.md (k8s L2 + immo L4).
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest cluster-mesh notifications scope
  - [ ] Retest api unit notifications scope
  - [ ] make scope-check green
  - [ ] Final gate step 1: push branch, open PR with BRANCH.md text as body (draft until green, no merge)
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers
