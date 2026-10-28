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
- [ ] Lot 1: P2-1 route content activation through W3.a and package flow peek; cover expired flows and content-origin/session binding in api/tests/api/artifacts-reader-activation.test.ts.
- [ ] Lot 2: P2-2 enforce storage-scope org equality on reverse lookup; cross-org denial in apps/artifact-content/tests/runtime.test.ts.
- [ ] Lot 3: P2-3 real-PG republication rejects stable A grant with 401 and activates pinned A with 200; restore pointer after test.
- [ ] Lot 4: P2-4 document grant-expiry session revocation bound in apps/artifact-content/README.md.
- [ ] Final validation: content suite; reader-activation/host-activation-store/host-recovery/app-artifacts-transport regressions; API/content typecheck and lint; logs; scope check; isolated teardown.
- [ ] Draft PR: BRANCH.md body, first plan comment, push, exact-head CI green; retain BRANCH.md for draft handoff.

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
