# Feature: W1.d artifact host jobs and recovery composition

## Objective
- [ ] Compose bounded private-artifact maintenance and closed-serving recovery through unchanged #861 ports.

## Scope / Guardrails
- [x] Owner dispatch W1.d, plan-v2 read in full; tests first, draft PR, green CI, no merge or deployment.
- [x] Branch `feat/app-cm-w1d`, worktree `tmp/worktrees/app-w1d`, base W1.b `8fca05df3`; merge only, never rebase.
- [x] Consume artifacts 0.2.1 unchanged; no package, migration, manifest or lock authoring.
- [x] Make-only; Docker build/start/test under `/home/antoinefa/.cache-tmp/sentropic-docker.lock`; down after every step.
- [x] `ENV=test-app-w1d` last; API/UI/Maildev UI 8795/5181/1088; no owner environments.
- [x] Atomic authored commits under 150 lines, selective staging, scope-check then `make commit`; no attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/lifecycle.ts`
  - `api/tests/api/artifacts-host-recovery.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `plan/**`
  - `.track/**`
  - `api/src/db/**`
  - `api/drizzle/**`
  - `**/package*.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- [x] Exception process: declare BR01-EXn with rationale, impact and rollback before expansion.

## Feedback Loop
- [ ] W1.c-dependent post-restore activation invalidation is drafted against UP-T PR #782 import path `@sentropic/artifacts/adapters/postgres-activation`, `PostgresActivationStore.cleanup/invalidate`; finalize host wiring and real adapter recovery proof when artifacts 0.2.3 publishes and W1.c lands. No copied PG algorithm or runtime import of an unpublished module.
- [ ] W3/W5 must fence all writers/readers, retire pre-restore grant signing authority and reconcile current denials before reopening; W1.d supplies composition only.

## AI Flaky tests
- [x] No AI tests, accepted flakes or increased timeouts.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one author; independent review before handoff, merge-only integration.

## UAT Management (in orchestration context)
- [x] Backend-only; web, Chrome and VSCode journeys remain W3/W4/W5; no root UAT stack.

## Plan / Todo (lot-based)
- [x] Lot 0: read lock, plan, MASTER/workflow/testing/API rules, README/TODO/template; create worktree and mechanically check branch.
- [x] Lot 1: `api/tests/api/artifacts-host-recovery.test.ts` first; red run on missing lifecycle composition, `/tmp/app-w1d-red.log`.
- [ ] Lot 2: `lifecycle.ts` private S3 and bounded preparation cleanup/collection; PG references, pins, failure retries and maintenance denial tested in the recovery file.
  - [x] Initial seven recovery cases pass, `/tmp/app-w1d-green-2.log`; fixtures use upstream `sha256:` digest codec.
- [ ] Lot 3: recovery fence orders activation invalidation and grant-key retirement before reopening; failure remains closed; expiry independent of cleanup, using upstream grant verifier.
- [ ] Lot 4: focused recovery/publication/migration suites, API typecheck/lint, healthy runtime logs, down and scope checks.
- [ ] Lot 5: draft PR against `feat/app-cm-integration`, exact BRANCH.md body, independent review, push and exact-head green CI; report W1.c remainder; do not merge.

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
