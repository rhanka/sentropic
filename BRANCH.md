# Feature: ops job-failure alerts L1 preprod wiring

## Objective
Wire the deployed L1 job-failure notifier in preprod only: ConfigMap values, recipients bearer Secret, ingest service client, runbook.

## Scope / Guardrails
- Scope limited to preprod wiring for the L1 notifier.
- Namespace sentropic-preprod only, never sentropic.
- No migration in api/drizzle.
- Make-only workflow, no direct Docker commands.
- Branch development in tmp/worktrees/notify-l1-wiring.
- Test campaigns on ENV=test-notify-wiring, never ENV=dev.
- In every make command, ENV=<env> passed last.
- All new text in English, except the French wiring report at .tmp/rv/notify-l1-wiring.md.
- Never print a secret value, only names.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/k8s/overlays/preprod/patch-api-config.yaml`
  - `api/src/services/auth/service-client-provisioning.ts`
  - `api/tests/unit/oauth-register-service-client.test.ts`
  - `docs/runbooks/ops-job-failure-notify.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- [ ] No open items.

## AI Flaky tests
- [ ] No AI flaky test recorded on this branch.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single preprod wiring change, one PR, one CI run.

## UAT Management (in orchestration context)
- [x] **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this branch, UAT is the post-merge preprod verification.
- [ ] Post-merge preprod verification by conductor or operator after deploy and rollout restart.
  - [ ] ConfigMap api carries the OPS keys in sentropic-preprod.
  - [ ] Secret sentropic-api carries the recipients bearer key in sentropic-preprod.
  - [ ] Ingest client registered with the ops scope in preprod.
  - [ ] Immo side configured, acceptance TEST replayed per the wiring report.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, .tmp/packets/COMMON-RULES.md.
  - [x] Read .tmp/rv/notify-l1-acceptance.md verdict and .tmp/rv/notify-l1.md design.
  - [x] Read origin/main code for exact OPS config keys and the provisioner scope list.
  - [x] Create worktree tmp/worktrees/notify-l1-wiring on branch feat/ops-notify-l1-preprod-wiring from origin/main, verified.
  - [x] Environment mapping: ENV=test-notify-wiring, API_PORT=8945, UI_PORT=5345, MAILDEV_UI_PORT=1245.
  - [x] Confirm preprod-only guardrail, never namespace sentropic.
- [ ] **Lot 1 — Preprod IaC and scope registry**
  - [x] Append OPS_JOB_FAILURE_INGEST_CLIENTS_JSON to patch-api-config.yaml.
  - [x] Append OPS_JOB_FAILURE_RECIPIENTS_URLS_JSON to patch-api-config.yaml.
  - [x] Add service:ops-job-failure-ingest to KNOWN_SERVICE_CLIENT_SCOPES.
  - [x] Extend the provisioner unit test with the new scope acceptance case.
  - [ ] Lot gate:
    - [ ] make typecheck-api ENV=test-notify-wiring
    - [ ] make lint-api ENV=test-notify-wiring
    - [ ] Scoped API test run for the provisioner suite ENV=test-notify-wiring
- [ ] **Lot 2 — Runbook**
  - [x] Create docs/runbooks/ops-job-failure-notify.md with credential names and rotation cycle.
  - [ ] Lot gate:
    - [ ] make scope-check passes in the worktree.
- [ ] **Lot 3 — Credentials and preprod Secret**
  - [x] Mint 64-hex recipients bearer into root .env under OPS_JOB_FAILURE_RECIPIENTS_BEARER_PREPROD.
  - [x] Mint 64-hex ingest secret into root .env under OPS_JOB_FAILURE_INGEST_SECRET_PREPROD.
  - [x] Patch Secret sentropic-api in sentropic-preprod with the bearer key from .env by name.
  - [ ] Register the ingest client after the PR is merged and deployed.
- [ ] **Lot 4 — PR and CI**
  - [ ] Push branch, open PR with BRANCH.md as body.
  - [ ] CI green on the PR head, resolve blockers.
- [ ] **Lot N — Final validation**
  - [ ] Retest scopes touched by Lot 1.
  - [ ] Delete BRANCH.md, push, leave the merge to the conductor.
  - [ ] Write .tmp/rv/notify-l1-wiring.md in French.
  - [ ] End with make down-volumes ENV=test-notify-wiring.
