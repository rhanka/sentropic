# Feature: W3.a trusted artifact reader activation

## Objective
  - [x] Deliver session-bound reader activation on the shared PostgreSQL store after W1.c/W2.b.
  - [x] Recheck current authority before consume; expose no production activation.

## Scope / Guardrails
- [x] Source: `.tmp/app-switch-week/plan-v2.md` W3.a, sections 2/3, and remote v2.4 M1-P P2/S1.
- [x] Base: `origin/feat/app-cm-integration`; branch `feat/app-cm-w3a`; worktree `tmp/worktrees/app-w3a`.
- [x] Frozen integration base: `21bf636d955a1dd679639a0b3e3b801024f83560`.
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
  - `api/tests/api/cluster-mesh-resources.test.ts`
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
- [x] Opus r1 P2: seven revocation writers time out with 55P03 after authorization and succeed after COMMIT/ROLLBACK; public artifacts without an explicit grant refuse both issue and consume.
- [x] R1 regression baseline: 60/63 pass, including all 14 post-authorization lock cases; public-without-grant issuance and both invalid control-origin configurations reproduce the three expected failures (`/tmp/pr806-r1-baseline.log`).
- [x] R1 mutation proof: temporarily removing the reader's five FOR SHARE clauses fails 10/14 fence cases; the four session/membership cases retain their separate authority locks. All clauses restored before qualification (`/tmp/pr806-r1-mutation.log`).
- [x] Opus r1 P3-1/2/3/4/5: recheck the package-locked flow; fail closed with 404 on invalid control-origin configuration; test the product credential gate; cache activation storage per namespace with failed-init retry; refresh baseline validation checkboxes.
- [x] R1 final local qualification with locked dependencies: 154/154 tests in nine suites, including 16 imported PostgreSQL vectors, pass (`/tmp/pr806-r1-suite-locked.log`).
- [x] Local setup repaired: initial Make preparation stopped before workspace install; `npm ls` exposed missing API-local jose 6.2.4 and an invalid root jose 5.10.0 resolution. Complete the official Make preparation; API typecheck and lint now pass (0 errors, 220 warnings, `/tmp/pr806-r1-quality-locked.log`).
- [x] Runtime evidence: initial Docker metadata writes required sandbox escalation; first API migration encountered PostgreSQL 57P03 during initial startup. Retry used the same isolated database once ready. Second campaign API health passed and its stack was removed; no production service was contacted.
- [x] W3.b handoff: `getProductArtifactReader().consume(verifiedSession, {flowId,ticketId,nonce,targetOrigin})` is internal. The content host must derive the session independently and obtain nonce proof from its host-only browser state; sign/set a grant only after a defined, acknowledged result. An uncertain commit throws and requires a fresh flow. No public consume dispatcher exists here.
- [x] Configuration handoff: `APP_ARTIFACT_HOST_ENABLED=1` plus `APP_ARTIFACT_READER_ENABLED=1` are both required. An approved `APP_ARTIFACT_CONTENT_BASE_DOMAIN` and exact `UI_BASE_URL` must be supplied before a later authorized activation. This branch sets neither flag.
- [ ] Independent final-head review remains conductor-owned. Opus r1 reviewed `db1ea5f59`: CHANGES, no P1, two P2 and five P3; author corrections follow `.h2a/reviews/pr806_opus_r1.md` in the primary checkout.
- [x] Local second campaign: 136/136 tests across nine suites, including all 16 imported PG vectors, pass (`/tmp/w3a-suite-2.log`). Typecheck identifies the required session credential `jkt: null`; supply it explicitly without changing session behavior.
- [x] Resources regression inventory must declare the additive reader path: first campaign failed its exact path assertion. Bounded test-only scope extension; no namespace author or resource verb changes.
- [x] First campaign reproduces the stable A-to-B-to-A gap. Bind the stable pointer row revision into the existing policy fence; pinned releases retain their immutable-release policy.
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
- [x] **Lot 1 — Tests before implementation**
  - [x] Add `api/tests/api/artifacts-reader-activation.test.ts` using real PostgreSQL and host migrations.
  - [x] Prove one consume, wrong browser/session/subject, replay, DB expiry and revocation.
  - [x] Prove release/channel/origin/profile/policy binding and stable-pointer fencing after waits.
    - [x] Add an explicit stable A-to-B-to-A pointer regression before strengthening the fence.
  - [x] Prove commit failure/uncertainty returns no grant and current-session fresh-flow recovery needs no MFA.
  - [x] Cover PG acquisition/consume failure and wrong flow/ticket association without granting or burning valid state.
  - [x] Prove authenticated resources route refuses forged identity and stays default-closed.
  - [x] Commit acceptance tests before service/route implementation (2943216c0, 0140c78d2, 2c5493946).
- [x] **Lot 2 — Trusted host composition**
  - [x] Implement transaction-bound current authority using the package ACL/lifecycle evaluator.
  - [x] Add reader service over W1.c; lock current session, memberships, ACL, release and stable pointer until commit.
  - [x] Return grant permission only after acknowledged package consume; never issue browser effects in callbacks.
  - [x] Mount distinct internal reader issuance port under the existing resources author fence.
  - [x] Keep APP-P1 public discovery/tool selection unchanged.
- [ ] **Lot 3 — Final validation and handoff**
  - [x] Run scoped activation/store/publication and resources/MCP/auth regression suites: 154/154 in `/tmp/pr806-r1-suite-locked.log`.
    - [x] `artifacts-reader-activation.test.ts`, `artifacts-host-activation-store.test.ts`, `artifacts-host-publication.test.ts`.
    - [x] `app-artifacts-transport.test.ts`, `app-mcp-registry.test.ts`, `cluster-mesh-resources.test.ts`.
    - [x] `cluster-mesh-namespace-inventory.test.ts`, `cluster-mesh-session.test.ts`, `tests/unit/auth/session-manager.test.ts`.
  - [x] R1 API typecheck/lint and hunk review passed; baseline CI receipt: [run 40621657187](https://github.com/rhanka/sentropic/actions/runs/40621657187).
  - [ ] Obtain independent reviews on the final implementation and reconcile findings.
  - [x] Pass mechanical scope checks before each commit.
  - [x] Push and create draft PR #806 against `feat/app-cm-integration` with this file as body.
  - [x] Post the execution plan as the first PR comment.
  - [x] Baseline CI green on exact pushed head `db1ea5f59`: [run 40621657187](https://github.com/rhanka/sentropic/actions/runs/40621657187); r1 must pass on its exact pushed head before handoff.
  - [x] Run make down and verify no remaining test services; final response carries PR and qualified head.
