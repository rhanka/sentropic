# Feature: Governed one-off Job to approve a cm_identity account role

## Objective
- [x] Give operators a governed, audited path to approve a cm_identity account or change its global role when no admin_app session exists, through the admin API's own service (`changeCmAccountAsAdmin`), mirroring the oauth-register(-service)-client Job pattern.

## Scope / Guardrails
- [x] Branch feat/cm-account-approve-job from origin/main 4b4c8632d; worktree tmp/worktrees/cm-account-approve-job; ENV=test-cm-approve (API 9471, UI 5671, Maildev 1571).
- [x] Make only; no Python, no attribution trailers, no CI skips or reruns; never ENV=dev.
- [x] The Job is never run by this lane: s-conductor runs it against the cluster.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/scripts/cm-account-approve.ts`
  - `api/tests/unit/cm-account-approve.test.ts`
  - `scripts/ci/cm-account-approve-job.test.mjs`
  - `api/package.json`
  - `docs/oauth-client-rotation.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `api/src/services/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (BRCMA-EX1)
  - `deploy/k8s/base/38-cm-account-approve-job.yaml` (BRCMA-EX2)
  - `deploy/k8s/base/15-networkpolicy.yaml` (BRCMA-EX2)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] `BRCMA-EX1` Makefile: one additive target `cm-account-approve-job`, plus `scripts/ci/cm-account-approve-job.test.mjs` appended to the `test-publishable-manifests` default list as the 37 Job test is (reason: no operator path to change a role without an admin_app session; impact: no existing target behaviour changed; rollback: delete the target and the list entry, the Job yaml stays valid for a direct kubectl apply).
- [x] `BRCMA-EX2` deploy/k8s/base: new one-off Job `38-cm-account-approve-job.yaml` (not in kustomization resources) and one additive NetworkPolicy `allow-cm-account-approve-to-postgres` (reason: default-deny-ingress baseline; impact: admits only pods labelled component cm-account-approve to postgres:5432; rollback: delete the yaml and the policy).
- [x] `attention`: the cluster-mesh `account.approved` audit event has no reason field; the reason is recorded as the Job annotation `sentropic.io/approval-reason` and in the wrapper receipt line, persisted in the run report (source-gap for a durable cm_identity reason column).

- [x] `acknowledge`: GLM 5.3 review of b60435eff = APPROVE (.h2a/reviews/pr-956-glm.md); non-blocking findings applied: first error line only on stderr, whitespace-only values refused by the wrapper, doc note on a `kubectl wait` timeout. Deferred: durable reason column (source-gap above), dedicated governance runbook.
- [x] `attention`: CI run 42459620840 on b60435eff: `test-e2e (1)` failed on `tests/07-matrix.spec.ts:477` (Matrix lock/presence, User B can lock, 2 s predicate); this diff touches no UI, matrix or lock code; fresh run on the next head, no rerun.
- [x] `attention`: CI run 42460546579 on 8a64e7b9a: `ci-capacity-receipts` fails on every attempt because the GitHub jobs API answers HTTP 502 for this run (137 jobs, 4 attempts); all functional jobs green; fresh run on this head (s-conductor, 08/11 03:20).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one small change, one PR, one CI.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Script and tests**
  - [x] `cm-account-approve.ts`: four required env variables, GlobalRole enum, self-approval refused, reason bounded; calls `changeCmAccountAsAdmin` approve; prints `{userId, roleBefore, roleAfter, status}`; exit 1 on refusal.
  - [x] `api/package.json` build compiles `dist/scripts/cm-account-approve.js` (same esbuild flags as the oauth scripts).
  - [x] `tests/unit/cm-account-approve.test.ts`: missing env, self-approval, role enum, service arguments, output without actor, reason or email.
- [x] **Lot 2 — Job, policy, wrapper, doc**
  - [x] `38-cm-account-approve-job.yaml`, `allow-cm-account-approve-to-postgres`, `make cm-account-approve-job`, section in `docs/oauth-client-rotation.md`.
  - [x] `scripts/ci/cm-account-approve-job.test.mjs`: rendered Job, dist build entry, kustomize exclusion, network policy, wrapper guards (`make test-publishable-manifests SCOPE=... ENV=test-cm-approve`: 8/8 with the 37 test).
  - [x] Lot gate: `make typecheck-api` (0 errors), `make lint-api` (0 errors), `make up-api-test` + scoped `make test-api-unit SCOPE=tests/unit/cm-account-approve.test.ts ENV=test-cm-approve` (10/10), `make down-volumes ENV=test-cm-approve`.
  - [x] Bundle smoke in the test api container: esbuild with the build flags, then self-approval and invalid role refused, and an unknown target refused through the real cm_identity read on the test DB.
- [ ] **Lot 3 — PR**
  - [ ] PR « feat(identity): governed one-off Job to approve an account role », CI green on the exact head, GLM review, merge by s-conductor.
