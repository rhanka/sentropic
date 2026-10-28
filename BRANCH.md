# Feature: W4.b authorized host registry catalog source

## Objective
- [ ] Project the single compiled app registry into the existing catalog and delegate authorized calls to the existing artifact transport.

## Scope / Guardrails
- [x] Owner deliverable 2, plan-v2.md W4.b line 147 and sections 2–5; dependencies W2.a and W4.a merged in base `21bf636d9`.
- [x] Branch `feat/app-cm-w4b`, worktree `tmp/worktrees/app-w4b`, draft PR base `feat/app-cm-integration`; merge only, never rebase or force-push.
- [x] Tests first; selective staging, scope-check and make commit below 150 lines; no attribution trailers.
- [x] Dedicated ports API_PORT=8802 UI_PORT=5188 MAILDEV_UI_PORT=1095; ENV=test-app-w4b last on every make.
- [x] Build/start/test commands use shared Docker flock; down after each step; no production activation, ENV=dev, clean-all or Python.
- [x] Preserve package ownership, locks, migrations and APP-P1 selection; no second catalog, mutation dispatcher or MCP name sanitizer.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/catalog/sources/host-registry-source.ts`
  - `api/src/services/catalog/request-authority.ts`
  - `api/src/services/skills/catalog.ts`
  - `api/src/services/artifacts/credentials.ts`
  - `api/tests/services/catalog/host-registry-source.spec.ts`
  - `api/tests/api/cluster-mesh-catalog.test.ts`
  - `api/tests/api/artifacts-host-credentials.test.ts`
  - `.github/workflows/app-cm-w4b.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `api/drizzle/**`
  - `deploy/**`
  - `package*.json`
  - `api/package*.json`
  - `plan/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- [x] Record rationale, impact and rollback in Feedback Loop before expansion.

## Feedback Loop
- [x] BR-W4B-EX1: integration PRs do not trigger ci.yml. Add branch-specific exact-head qualification using existing make targets and teardown, without publication/deployment. Rollback removes workflow.
- [x] Turn execution must retain conversation authority through the final host transaction. Extend only the existing credential reader with a workspace-bound turn credential; host authorization remains the sole effect guard. Rollback removes credential kind and source wiring.

## AI Flaky tests
- [x] No AI-dependent acceptance or timeout increases.

## Orchestration Mode (AI-selected)
- [x] Mono-branch author; independent final reviews use read-only peers.

## UAT Management (in orchestration context)
- [x] Backend catalog only; automated HTTP discovery and model/executor acceptance; no root-dev or production UAT.

## Plan / Todo (lot-based)
- [x] Lot 0 — Read rules, template, W4.b row and cited sections; create assigned worktree; mechanical branch check passes.
- [ ] Lot 1 — Tests authored first in `api/tests/services/catalog/host-registry-source.spec.ts`: exact names/schema, denied contexts, read-only, interleaved views, filtering before ranking/serialization and one execution; initial run pending stack readiness.
- [ ] Lot 2 — Implement source; register once in `skills/catalog.ts`; await public compiled plan in `request-authority.ts`; no private cache.
- [ ] Lot 3 — Tests first in `artifacts-host-credentials.test.ts` for workspace-bound turn and revocation; extend existing credential reader.
- [ ] Lot 4 — Extend `cluster-mesh-catalog.test.ts`: mounted discovery, model/executor, durable single effect and revocation; preserve HTTP/MCP regressions.
- [ ] Lot 5 — Scoped catalog/registry/transport/credential suites, API typecheck/lint, logs and down; exact-head CI workflow; reconcile independent reviews.
- [ ] Lot 6 — Scope-check each commit, push, draft PR from this file and first plan comment; CI green on reported head; no merge or activation.

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
