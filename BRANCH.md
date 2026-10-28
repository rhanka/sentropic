# Feature: App W3.b private artifact content process

## Objective
- [ ] Deliver the thin content process over artifacts 0.2.4 ports; no production activation.

## Scope / Guardrails
- [x] Base db981f14a; branch feat/app-cm-w3b; worktree tmp/worktrees/app-w3b; merge only.
- [x] ENV=test-app-w3b last; API_PORT=8803 UI_PORT=5189 MAILDEV_UI_PORT=1096; shared Docker flock; teardown after testing.
- [x] No Python, production actions, package changes, migrations, image or deployment changes; selective commits below 150 lines.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `apps/artifact-content/**`
  - `.github/workflows/app-cm-w3b.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `api/**`
  - `deploy/**`
  - `plan/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`

## Feedback Loop
- [x] BR-W3B-EX1: exact-head branch CI using existing Make targets; integration-target PRs do not run main CI. Impact: qualification only; rollback: remove workflow.
- [x] W3.c owns canonical image; W3.d owns serving configuration; W3.e owns live HTTPS/browser matrix after FIRST-IMMO. Local fixtures only here.

## AI Flaky tests
- [x] No AI-dependent tests or timeout changes.
## Orchestration Mode (AI-selected)
- [x] Mono-branch code author; conductor retains independent final-head reviews and merge clearance.
## UAT Management (in orchestration context)
- [ ] Local HTTP process qualification only; no root-dev or production UAT.
## Plan / Todo (lot-based)
- [x] Lot 0: read W3.b row, sections 2/3/4/5, rules and template; mechanical branch check and port availability pass.
- [x] Lot 1: acceptance tests committed before host implementation; execution pending the shared Docker lock.
- [x] Runtime acceptance added first: real isolated PG, W3.a consume race, new process instance, membership/ACL denial and key rotation.
- [x] Lot 2: host/runtime/index reuse package content/PG/S3 ports and W3.a consume; separate default-closed listener, no publication dispatcher.
- [x] Host/runtime implemented over upstream reads and W3.a; signing key and live authority are rechecked after blob waits.
- [x] Listener tests added before entrypoint: default-closed real TCP request and enabled configuration refusal before listening.
- [ ] Lot 3: typecheck/lint, focused content and W3.a regressions, HTTP listener smoke; scope checks; isolated teardown.
- [ ] Lot 4: draft PR against feat/app-cm-integration, BRANCH.md body, first plan comment, push and green CI on exact head; report PR and SHA.
