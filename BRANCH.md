# Feature: W2.a compiled app MCP registry

## Objective
- [ ] Compile one cluster-mesh provider registry with exact APP-P1 public names for W4.

## Scope / Guardrails
- [x] Base W1.b #780 `8fca05df3`; mesh 0.22.4; merge only, never rebase.
- [x] Worktree `tmp/worktrees/app-w2a`, branch `feat/app-cm-w2a`; draft against `feat/app-cm-integration`; no merge.
- [x] Read Docker lock, full plan-v2, contract-v9 registry boundaries, W0 host fit and W1.b contract.
- [x] Make-only; Docker builds/tests/start under shared flock; down after every step.
- [x] `ENV=test-app-w2a` last; API/UI/Maildev ports 8794/5180/1087 if needed; no owner environment.
- [x] Tests first; specific staging; scope-check before make commit; authored commits below 150 lines.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `plan/**`
  - `.track/**`
  - `api/src/routes/**`
  - `api/package*.json`
  - `package-lock.json`
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`
- [x] Exception process: BR02-EXn records reason, impact and rollback before scope expansion.

## Feedback Loop
- [x] W2.b owns route mounting, identity/dispatch integration and root/API lock reconciliation.
- [x] W4 consumes the returned compiled registry exact-name map without sanitization.
- [ ] Independent review and final CI receipts remain required; no inherited review approves this diff.

## AI Flaky tests
- [x] No AI calls, accepted flakes or timeout increases.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one author; independent review only at the final commit.

## UAT Management (in orchestration context)
- [x] Compilation only; web/Chrome/VSCode flows belong to W2.b/W4/W5; no UI or E2E changes.

## Plan / Todo (lot-based)
- [x] Lot 0: mechanical branch check; freeze scope, dependencies, environment and contract.
- [ ] Lot 1: tests first in `api/tests/api/app-mcp-registry.test.ts`; capture missing-module red.
- [ ] Lot 2: implement `api/src/services/mcp/cluster-registry.ts` using mesh modules, builtin and facade.
- [ ] Lot 3: same test file covers exact names, explicit selection/config, collisions, missing peers, profile/schema/policy integrity and atomic refusal.
- [ ] Lot 4: focused API suite, API typecheck/lint, relevant registry and MCP regressions; cleanup.
- [ ] Lot 5: independent review; push, draft PR from this file, exact-head CI green; report names and SHA.

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
