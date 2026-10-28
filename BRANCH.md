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

## Inherited main qualification record

> # Feature: Decision Q1 live qualification smoke
>
> ## Objective
> - [ ] Record bounded live protocol and identity evidence for JEV and OpenAI Decisions; keep production refused pending OD-4 calibration.
>
> ## Scope / Guardrails
> - [x] Owner GO dated 2026-10-29; spec v4 section 7.4; H1/H2 base `213638676`.
> - [x] Worktree `tmp/worktrees/decision-q1`, branch `feat/decision-q1-live`, mono-branch.
> - [x] Make only; no Python; secrets enter Compose from the existing root `.env` without copying values.
> - [x] Maximum three attempts per candidate, counting failed, refused and ambiguous calls; no retries.
> - [x] Local qualification only, `ENV=test-decision-q1` last; API 8802, UI 5202, Maildev 1102.
> - [x] Serialize Docker with `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`; run `make down` afterward.
>
> ## Branch Scope Boundaries (MANDATORY)
> - **Allowed Paths (implementation scope)**:
>   - `BRANCH.md`
>   - `spec/decision/**`
>   - `packages/llm-mesh/src/decision/descriptor.ts`
>   - `packages/llm-mesh/src/decision/openai-descriptor.ts`
>   - `packages/llm-mesh/src/decision/descriptor-validation.ts`
>   - `packages/llm-mesh/package.json`
>   - `package-lock.json`
>   - `packages/llm-mesh/tests/decision-public-surface.test.ts`
>   - `packages/llm-mesh/tests/decision-jev-v4l3.test.ts`
>   - `packages/llm-mesh/tests/decision-qualification-admission.test.ts`
>   - `packages/llm-mesh/tests/decision-qualification.test.ts`
>   - `packages/llm-mesh/tests/decision-jev-request.test.ts`
>   - `packages/llm-mesh/tests/decision-openai-routing.test.ts`
>   - `packages/cluster-mesh/tests/fixtures/train.ts`
>   - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
>   - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
> - **Forbidden Paths (must not change in this branch)**:
>   - `Makefile`
>   - `docker-compose*.yml`
>   - `.cursor/rules/**`
>   - `api/**`
> - **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
>   - `.github/workflows/**`
>
> ## Feedback Loop
> - [x] No calibration authorized; live observations cannot qualify immutable weights, billing beyond the admitted bound, or production readiness.
> - [x] Q1-CRED-01: JEV preflight refused peripheral whitespace; normalized transiently after Compose injection, source env unchanged; refusal consumes attempt 1.
> - [x] Q1-INV-01: parser previously forbade observed IDs with unqualified production status; permit evidence inventory while retaining admission gates; regression keeps nonempty IDs and proves production refusal.
> - [ ] Q1-REV-01: conductor to select two exact complementary reviewer models before merge; h2a discovery has host presence but no model identities, no configured gateway catalog; no consensus claimed.
> - [x] Q1-CI-01: reproduced job 123314702961's three stale-version failures; rebound independent train and selected fixture to llm-mesh 0.32.2 and guarded archive SHA-512; 1,228 cluster-mesh tests and scope pass, 138 expected skips; see `spec/decision/q1-2026-10-29/ci-repair.md`.
>
> ## AI Flaky tests
> - [x] No flaky acceptance or additional live calls beyond the cap.
>
> ## Orchestration Mode (AI-selected)
> - [x] Mono-branch; no integration from other branches.
>
> ## UAT Management (in orchestration context)
> - [x] API-only qualification fixture; no UI, Chrome or VSCode surface change.
>
> ## Plan / Todo (lot-based)
> - [x] **Lot 0 — Baseline and constraints**
>   - [x] Read master/workflow rules, spec section 7.4, API host and descriptors; mechanical branch check passed.
>   - [x] Verify ports, credential names, control pricing and isolated stack.
> - [x] **Lot 1 — Bounded live evidence**
>   - [x] Fix a public synthetic binary criterion and retain only that fixture input.
>   - [x] No documented zero-cost Decisions entitlement probe established; first POST counts as attempt 1.
>   - [x] Record served identity, tokens, priced cost, billing bound, latency, verdict shape and refusals per attempt.
>   - [x] Fail closed on descriptor identity mismatch; three calls per candidate including the JEV preflight refusal, five egresses total, 77 micro-USD.
> - [x] **Lot 2 — Evidence and descriptors**
>   - [x] Retain scrubbed receipts in `spec/decision/`; accepted identities/evidenceRefs cite only observed results.
>   - [x] Bump llm-mesh from published 0.32.1 to 0.32.2; align workspace lock and public version assertion.
>   - [x] Preserve unqualified production and OD-4 calibration requirement; 16 host/route tests pass.
> - [ ] **Lot 3 — Final validation and draft PR**
>   - [x] Mesh descriptor, qualification, adapter, pricing, public and request suites: 88 files / 1,566 tests pass.
>   - [x] llm-mesh typecheck/lint and mechanical scope checks pass; commits at most 150 lines.
>   - [x] Secret scan, attempt counts, identity comparison and durable 77 micro-USD ledger verified; zero reserved/pending.
>   - [x] Stop local stack with `make down`; publish report `spec/decision/q1-live-smoke.md`.
>   - [x] Draft PR #834 created against main; exact-head CI remains the final checkpoint.
>   - [ ] Observe CI completed/success on exact head; report head, 77 micro-USD and candidate outcomes.
