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
- [x] Review MIG-1/MIG-2 accepted: test future reserved-slot eligibility and concurrent first installation; install 0020 in the host asset journal without advancing Drizzle's control frontier, and retain one connection for the API migration lock.
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
- [x] Lot 2: control SQL/metadata for host KV and one package journal; hash-checked L3/L6 installation on one leased transaction; bounded migration runner hook after public/control streams.
  - [x] Add control 0020/metadata, scope-bound PostgreSQL KV and pinned package asset installer; upstream bytes remain unchanged.
- [ ] Lot 3: scoped PostgreSQL tests, API typecheck/lint and migration regressions; inspect every hunk and clean test stack.
- [ ] Lot 4: independent review/reconciliation; exact BRANCH.md PR body, push and draft delivery with green exact-head CI.
- [ ] Handoff: W1.b gets durable KV, installed asset identities/hashes and startup ordering; UP-T and W0 gates remain explicit.

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
