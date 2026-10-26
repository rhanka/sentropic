# Feature: W1.a durable host schema and package-asset installation

## Objective
- [ ] Install durable artifact host KV and unchanged upstream SQL assets through the API migration authority.

## Scope / Guardrails
- [x] Owner dispatch: W1.a of `.tmp/app-switch-week/plan-v2.md`; draft PR only, no merge or deployment.
- [x] Worktree `tmp/worktrees/app-w1a`, branch `feat/app-cm-w1a`; upstream `2568c25cd6f03d706356fd0be5bd9e0c601a0bcf`, frozen in #702 reservations.md.
- [x] Create missing `feat/app-cm-integration` at the same SHA; integration waits for W0-close.e.
- [x] Only control `0020_app_artifact_host.sql`; preserve #677 control 0012–0019. Ref/worktree rescan found no 0020 SQL collision on 26 October.
- [x] Make-only, shared Docker flock for build/test/start and matching down after each step; `ENV=test-app-w1a` last.
- [x] API/UI/Maildev UI ports 8791/5177/1084; verify ownership before listeners. Never test on dev.
- [x] Workspace sources unchanged; W2.b owns manifests/locks. No package SQL copies, edits or host activation algorithm.
- [x] Atomic commits below 150 lines; selective staging, scope-check, make commit; no attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/host-storage.ts`
  - `api/src/db/run-migrations.ts`
  - `api/drizzle/control/0020_app_artifact_host.sql`
  - `api/drizzle/control/meta/_journal.json`
  - `api/tests/api/artifacts-host-migrations.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `plan/**`
  - `.track/**`
  - `api/package*.json`
  - `package*.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- [x] **Exception process**: declare BR-W1A-EXn with reason, impact and rollback before scope expansion.

## Feedback Loop
- [ ] UP-T: #702 host-fit records no activation adapter/SQL in frozen artifacts 0.2.0. Package integrator must deliver reviewed bytes/export/hash; W1.c consumes them. Activation readiness is not claimed.
- [ ] W0-close.c/e remain external gates; this draft must not integrate before W0-close.e.

## AI Flaky tests
- [x] No AI tests or accepted flakes; no timeout increases.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one author, isolated W1.a topic on the app integration train.

## UAT Management (in orchestration context)
- [x] Backend migration only; no UI, Chrome or VSCode changes. No root-dev UAT needed.

## Plan / Todo (lot-based)
- [x] Lot 0: read lock, full plan, MASTER/workflow/testing, template and W0 a/d evidence; mechanical branch check passes.
- [x] Lot 1: tests authored first in `api/tests/api/artifacts-host-migrations.test.ts`: empty DB, rerun, asset/journal mismatch refusal, fresh-process restart, scoped concurrent KV insert; execution waits for shared Docker lock.
- [ ] Lot 2: control SQL/metadata for host KV and one package journal; hash-checked L3/L6 installation on one leased transaction; bounded migration runner hook.
- [ ] Lot 3: scoped PostgreSQL tests, API typecheck/lint and migration regressions; inspect every hunk and clean test stack.
- [ ] Lot 4: independent review/reconciliation; exact BRANCH.md PR body, push and draft delivery with green exact-head CI.
- [ ] Handoff: W1.b gets durable KV, installed asset identities/hashes and startup ordering; UP-T and W0 gates remain explicit.
