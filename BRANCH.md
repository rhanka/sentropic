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
