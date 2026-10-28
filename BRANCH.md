# Feature: App W3.b private artifact content process

## Objective
- [x] Deliver the thin content process over artifacts 0.2.4 ports; no production activation.

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
- [x] Local HTTP process qualification only; no root-dev or production UAT.
## Plan / Todo (lot-based)
- [x] Lot 0: read W3.b row, sections 2/3/4/5, rules and template; mechanical branch check and port availability pass.
- [x] Lot 1: acceptance tests committed before host implementation; 31 content tests now pass.
- [x] Runtime acceptance added first: real isolated PG, W3.a consume race, new process instance, membership/ACL denial and key rotation.
- [x] Lot 2: host/runtime/index reuse package content/PG/S3 ports and W3.a consume; separate default-closed listener, no publication dispatcher.
- [x] Host/runtime implemented over upstream reads and W3.a; signing key and live authority are rechecked after blob waits.
- [x] Listener tests added before entrypoint: default-closed real TCP request and enabled configuration refusal before listening.
- [x] Additional acceptance before correction: stable-pointer movement during blob wait must discard bytes; denied HEAD must have no body.
- [x] First execution reproduced the pointer race (200 vs 401) and denied HEAD body; post-read pointer check and universal HEAD body suppression now pass their regressions.
- [x] Contract edge tests added before hardening: ambiguous/flooded grant cookies, service-worker fetch/CSP and reserved reader routes.
- [x] Real listener passes after fixture sends the ingress Host explicitly and uses APP-P1 compiled digest. Three edge regressions reproduced before bounded-cookie, worker and route hardening; typecheck found a heterogeneous test table, now explicitly typed.
- [x] Configuration/bridge ownership documented; exact-head CI reuses existing Make targets and always tears down its isolated stack.
- [x] Content lint/type configuration includes the new app and its tests explicitly; package/API manifests remain unchanged.
- [x] Extended runtime acceptance: account/tenant/lifecycle/release denials plus enabled real listener, read-only S3 adapter and mounted-key rotation.
- [x] Local qualification: 31 content tests + 110 app regressions pass (including all 16 imported PG vectors); content/API types pass; lint has 0 errors (1 content warning, 220 API warnings). Official make scope-check passes; runtime logs inspected; make down ENV=test-app-w3b completed; make ps shows no services.
- [x] Draft code-author handoff only: independent final-head reviews remain conductor-owned; no merge clearance, image/deployment/browser-matrix qualification or production activation is claimed.
- [x] Lot 3: typecheck/lint, 141 focused tests, enabled/default-closed HTTP listener, official scope check and isolated teardown pass.
- [x] Lot 4 preparation: exact-head CI configured; draft targets feat/app-cm-integration with this file as body and a first plan comment. Green pushed-head CI is required before author delivery; its final SHA/run receipt belongs in the PR checks and final handoff.
