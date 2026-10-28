# Feature: W3.a trusted artifact reader activation

## Objective
- [ ] Deliver session-bound reader activation on the shared PostgreSQL store after W1.c/W2.b.
- [ ] Recheck current authority before consume; expose no production activation.

## Scope / Guardrails
- [x] Source: `.tmp/app-switch-week/plan-v2.md` W3.a, sections 2/3, and remote v2.4 M1-P P2/S1.
- [x] Base: `origin/feat/app-cm-integration`; branch `feat/app-cm-w3a`; worktree `tmp/worktrees/app-w3a`.
- [x] Dependencies inherited: W1.a/b/c/d, W2.a/b, W4.a, W0-close.d refresh #796.
- [x] ENV `test-app-w3a`; API_PORT=8801 UI_PORT=5187 MAILDEV_UI_PORT=1094.
- [x] All make commands end with ENV=test-app-w3a; Docker/test commands use the shared flock.
- [x] Merge only; never rebase, force-push, clean-all, ENV=dev or production activation.
- [x] Reuse upstream activation adapter/SQL unchanged; no package or migration edits.
- [x] Selective staging; make commit; fewer than 150 changed lines per commit; no AI trailers.
- [x] English source and Markdown; no new dependencies.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/reader-activation.ts`
  - `api/src/services/artifacts/authorization.ts`
  - `api/src/services/artifacts/instance.ts`
  - `api/src/routes/namespaces/resources.ts`
  - `api/src/routes/namespaces/artifacts.ts`
  - `api/src/routes/namespaces/resources-module.ts`
  - `api/tests/api/artifacts-reader-activation.test.ts`
  - `.github/workflows/app-cm-w3a.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `api/drizzle/**`
  - `deploy/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `spec/**`
  - `.github/workflows/**`
- **Exception process**:
  - [x] Record BRW3A-EXn reason, impact and rollback before any scope extension.

## Feedback Loop
- [x] BRW3A-EX1 — exact-head CI is required; ci.yml excludes the app integration base. Add only `.github/workflows/app-cm-w3a.yml`, following W1.c's isolated qualification workflow. Impact: branch-only tests/typecheck/lint, no publish/deploy. Rollback: remove this workflow.
- [x] Track remains conductor-owned; this branch updates its mergeable BRANCH source only.
- [x] W3.b owns content cookies/browser handshake; W3.e owns real HTTPS/browser acceptance after FIRST-IMMO.

## AI Flaky tests
- [x] No AI-dependent acceptance; all new tests must pass without an exception.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; no copied commits; independent reviewers read the same final target.
- [ ] Multi-branch.

## UAT Management (in orchestration context)
- [x] Backend-only lot; automated isolated route/service tests cover this delivery.
- [x] No live activation or root dev UAT; browser/DNS/TLS qualification belongs to W3.b–e.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read MASTER/workflow/testing/API/architecture rules, README/TODO, template and cited contracts.
  - [x] Create isolated worktree and pass `harness check branch`.
  - [x] Read W1.c adapter, W2.b transport and current session/ACL authority.
  - [x] Freeze file scope, ports, cleanup and no-production guardrails.
- [ ] **Lot 1 — Tests before implementation**
  - [x] Add `api/tests/api/artifacts-reader-activation.test.ts` using real PostgreSQL and host migrations.
  - [ ] Prove one consume, wrong browser/session/subject, replay, DB expiry and revocation.
  - [ ] Prove release/channel/origin/profile/policy binding and stable-pointer fencing after waits.
  - [ ] Prove commit failure/uncertainty returns no grant and current-session fresh-flow recovery needs no MFA.
  - [ ] Prove authenticated resources route refuses forged identity and stays default-closed.
  - [ ] Record focused red runs before adding each behavior.
- [ ] **Lot 2 — Trusted host composition**
  - [x] Implement transaction-bound current authority using the package ACL/lifecycle evaluator.
  - [x] Add reader service over W1.c; lock current session, memberships, ACL, release and stable pointer until commit.
  - [x] Return grant permission only after acknowledged package consume; never issue browser effects in callbacks.
  - [x] Mount distinct internal reader issuance port under the existing resources author fence.
  - [x] Keep APP-P1 public discovery/tool selection unchanged.
- [ ] **Lot 3 — Final validation and handoff**
  - [ ] Run scoped activation/store/publication and resources/MCP/auth regression suites.
  - [ ] Run API typecheck/lint and review every diff hunk.
  - [ ] Obtain independent reviews on the final implementation and reconcile findings.
  - [ ] Pass mechanical scope checks before each commit.
  - [ ] Push and create draft PR against `feat/app-cm-integration` with this file as body.
  - [ ] Post the execution plan as the first PR comment.
  - [ ] Verify CI green on the exact pushed head.
  - [ ] Run make down and verify no remaining test services; report PR and head.
