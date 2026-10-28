# Feature: App W3.b reader authority follow-up

## Objective
- [x] Address PR #810 P2-1 through P2-4 with reader authority, tenant isolation, real-PG coverage and contract clarification.

## Scope / Guardrails
- [x] Base origin/feat/app-cm-integration at d4625d764; branch feat/app-cm-w3b-followup; worktree tmp/worktrees/app-w3b-fu.
- [x] Merge only; no rebase or force push; selective make commits below 150 changed lines; no AI trailers or Python.
- [x] API_PORT=8804 UI_PORT=5190 MAILDEV_UI_PORT=1097; ENV=test-app-w3bfu last; shared Docker flock; make down after qualification.
- [x] No migrations, package changes, deployment or production activation; root dev remains reserved for owner UAT.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `apps/artifact-content/**`
  - `api/src/services/artifacts/reader-activation.ts`
  - `api/tests/api/artifacts-reader-activation.test.ts`
  - `.github/workflows/app-cm-w3b.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `deploy/**`
  - `plan/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`

## Feedback Loop
- [x] BR-W3BFU-EX1: extend existing exact-head qualification workflow to this branch and isolated ports/env; impact: CI only; rollback: revert the workflow edit.
- [x] W3.e owns real TLS/browser acceptance; this draft author handoff does not authorize merge.

## AI Flaky tests
- [x] No AI-dependent tests or timeout changes.

## Orchestration Mode (AI-selected)
- [x] Mono-branch code author; independent final review remains conductor-owned.

## UAT Management (in orchestration context)
- [x] API/content changes only; isolated PostgreSQL and HTTP acceptance; no UI, Chrome or VSCode changes requiring manual UAT.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, review and template; create isolated worktree; mechanical harness branch check passes.
- [x] Lot 1: P2-1 route content activation through W3.a and package flow peek; cover expired flows and content-origin/session binding in api/tests/api/artifacts-reader-activation.test.ts.
- [x] Lot 2: P2-2 enforce storage-scope org equality on reverse lookup; cross-org denial in apps/artifact-content/tests/runtime.test.ts (reproduced 200 before correction, now 404).
- [x] Lot 3: P2-3 real-PG republication rejects stable A grant with 401 and activates pinned A with 200; restore pointer after test.
- [x] Lot 4: P2-4 document grant-expiry session revocation bound in apps/artifact-content/README.md.
- [x] Final validation: 32 content tests + 114 app regressions (16/16 PG vectors); API/content typecheck pass; lint has 0 errors (220 API warnings, 1 content warning); logs inspected; harness branch/scope pass.
- [x] Cleanup: make down ENV=test-app-w3bfu and make ps confirms no services.
- [x] Draft PR preparation: BRANCH.md body, first plan comment and exact-head branch CI configured; retain BRANCH.md for draft handoff and require green pushed-head CI before delivery.
