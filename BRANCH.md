# Feature: Decision Q1 live qualification smoke

## Objective
- [ ] Record bounded live protocol and identity evidence for JEV and OpenAI Decisions; keep production refused pending OD-4 calibration.

## Scope / Guardrails
- [x] Owner GO dated 2026-10-29; spec v4 section 7.4; H1/H2 base `213638676`.
- [x] Worktree `tmp/worktrees/decision-q1`, branch `feat/decision-q1-live`, mono-branch.
- [x] Make only; no Python; secrets enter Compose from the existing root `.env` without copying values.
- [x] Maximum three attempts per candidate, counting failed, refused and ambiguous calls; no retries.
- [x] Local qualification only, `ENV=test-decision-q1` last; API 8802, UI 5202, Maildev 1102.
- [x] Serialize Docker with `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`; run `make down` afterward.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/decision/**`
  - `packages/llm-mesh/src/decision/descriptor.ts`
  - `packages/llm-mesh/src/decision/openai-descriptor.ts`
  - `packages/llm-mesh/src/decision/descriptor-validation.ts`
  - `packages/llm-mesh/package.json`
  - `package-lock.json`
  - `packages/llm-mesh/tests/decision-public-surface.test.ts`
  - `packages/llm-mesh/tests/decision-jev-v4l3.test.ts`
  - `packages/llm-mesh/tests/decision-qualification-admission.test.ts`
  - `packages/llm-mesh/tests/decision-qualification.test.ts`
  - `packages/llm-mesh/tests/decision-jev-request.test.ts`
  - `packages/llm-mesh/tests/decision-openai-routing.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`

## Feedback Loop
- [x] No calibration authorized; live observations cannot qualify immutable weights, billing beyond the admitted bound, or production readiness.
- [x] Q1-CRED-01: JEV preflight refused peripheral whitespace; normalized transiently after Compose injection, source env unchanged; refusal consumes attempt 1.
- [x] Q1-INV-01: parser previously forbade observed IDs with unqualified production status; permit evidence inventory while retaining admission gates; regression keeps nonempty IDs and proves production refusal.

## AI Flaky tests
- [x] No flaky acceptance or additional live calls beyond the cap.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; no integration from other branches.

## UAT Management (in orchestration context)
- [x] API-only qualification fixture; no UI, Chrome or VSCode surface change.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read master/workflow rules, spec section 7.4, API host and descriptors; mechanical branch check passed.
  - [x] Verify ports, credential names, control pricing and isolated stack.
- [x] **Lot 1 — Bounded live evidence**
  - [x] Fix a public synthetic binary criterion and retain only that fixture input.
  - [x] No documented zero-cost Decisions entitlement probe established; first POST counts as attempt 1.
  - [x] Record served identity, tokens, priced cost, billing bound, latency, verdict shape and refusals per attempt.
  - [x] Fail closed on descriptor identity mismatch; three calls per candidate including the JEV preflight refusal, five egresses total, 77 micro-USD.
- [x] **Lot 2 — Evidence and descriptors**
  - [x] Retain scrubbed receipts in `spec/decision/`; accepted identities/evidenceRefs cite only observed results.
  - [x] Bump llm-mesh from published 0.32.1 to 0.32.2; align workspace lock and public version assertion.
  - [x] Preserve unqualified production and OD-4 calibration requirement; 16 host/route tests pass.
- [ ] **Lot 3 — Final validation and draft PR**
  - [x] Mesh descriptor, qualification, adapter, pricing, public and request suites: 88 files / 1,566 tests pass.
  - [ ] Run applicable typecheck/lint and mechanical scope check before each atomic commit (at most 150 lines).
  - [ ] Verify secret-free receipts/diff, stop test stack, create draft PR to main using this plan.
  - [ ] Observe CI completed/success on exact head; report head, cost and candidate outcomes.
