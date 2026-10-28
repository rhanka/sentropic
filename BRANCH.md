# Feature: W3.c canonical artifact content image

## Objective
- [ ] Ship the W3.b content entrypoint in the canonical API/IdP image with content hash, runtime and identity evidence.

## Scope / Guardrails
- [x] Implement `.tmp/app-switch-week/plan-v2.md` W3.c, sections 1–5; inherit W3.b (#810) from base `d4625d764`.
- [x] Work only in `tmp/worktrees/app-w3c`, branch `feat/app-cm-w3c`, base `origin/feat/app-cm-integration`.
- [x] Sole W3.c build writer; merge only, never rebase or force-push; no package/lock/schema changes.
- [x] Use Make targets, ENV last, shared `/home/antoinefa/.cache-tmp/sentropic-docker.lock` for every Docker/test step.
- [x] Use `API_PORT=8805 UI_PORT=5191 MAILDEV_UI_PORT=1098 ENV=test-app-w3c`; ports checked free before startup.
- [x] No production activation, publication or deployment; no Python, AI trailers, broad staging or destructive cleanup.
- [x] Keep selective commits below 150 changed lines and stop the isolated stack after each Docker step.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/Dockerfile`
  - `scripts/test-artifact-content-image.sh`
  - `scripts/test-api-image-canonical.sh`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `packages/**`
  - `api/src/**`
  - `apps/artifact-content/**`
  - `deploy/**`
  - `docker-compose*.yml`
  - `.track/**`
  - `.cursor/rules/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/ci.yml`
  - `.dockerignore`
- [x] **Exception process**: BRW3C-EX1 below records the plan-authorized build/CI extension before edits.

## Feedback Loop
- [x] BRW3C-EX1 — acknowledged: W3.c explicitly authorizes `Makefile`, `.github/workflows/ci.yml` and `.dockerignore` for content hash/filters, test target/CI gate and generated bundle exclusion. Impact: canonical API image and its validation. Rollback: revert W3.c commits; retain W3.b source and prior qualified image. No deployment edits.
- [x] Track remains single-writer: update this mergeable plan; conductor owns import and independent final acceptance.

## AI Flaky tests
- [x] No AI/provider behavior changes or accepted flaky tests; all selected checks must pass.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one code author; merge-only integration, draft PR against `feat/app-cm-integration`.

## UAT Management (in orchestration context)
- [x] No UI change; isolated image health/denial qualification only. W3.d/e own deployment and HTTPS browser acceptance.
- [x] No live activation; FIRST-IMMO and production owner gates remain downstream.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read MASTER/workflow/testing/subagents, README/TODO/PLAN, branch template, W3.c row and cited policy/dependency sections.
  - [x] Read W3.b entrypoint/runtime and #712 Dockerfile, resolver, publisher, canonical tests, hash inputs and CI filters.
  - [x] Create isolated worktree and pass `harness check branch` before work.
- [x] **Lot 1 — Content hash and build inputs**
  - [x] Add failing content-only invalidation and CI-filter tests in `scripts/test-artifact-content-image.sh`: both fail on the missing content input/filter.
  - [x] Extend canonical required-input inventory in `scripts/test-api-image-canonical.sh`.
  - [x] Hash/copy content sources, exclude generated bundles and align `.github/workflows/ci.yml` filters.
  - [x] Gate: scoped static image/hash/filter tests turned red then green; CI filter guard passes.
- [ ] **Lot 2 — Production entrypoint**
  - [x] Add real-image test for pruned dependencies, Node startup, health, denial and shutdown; assembly test fails because content sources are not copied.
  - [x] Compile/copy content bundle in `api/Dockerfile`, retaining existing API/IdP commands and single image resolver.
  - [ ] Gate: build canonical image once, run content process with no activation/DB/storage credentials, verify health and denial.
- [ ] **Lot 3 — Artifact identity and CI**
  - [ ] Test content image receipt equality and collision refusal using #712 canonical resolver/publisher and promotion pins.
  - [ ] Wire real content-image verification before image save/upload in `.github/workflows/ci.yml`.
  - [ ] Gate: `test-ci-api-image-canonical`, `test-ci-api-tag-guard`, `test-ci-api-runtime`, `test-artifact-content-image`, `check-ci-version-filters`.
- [ ] **Lot 4 — Docs consolidation and final validation**
  - [ ] Keep acceptance evidence and review findings in this plan; no unrelated spec edits or package bumps.
  - [ ] Review every changed hunk; pass branch/scope checks and shell syntax checks.
  - [ ] Create draft PR with this file as body and a 3–6 step plan comment; push without force.
  - [ ] Confirm GitHub CI success on the exact final head and report PR/head.
  - [ ] Run `make down ENV=test-app-w3c` and verify no remaining project services.

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
