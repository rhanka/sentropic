# Feature: W2.a compiled app MCP registry

## Objective
- [x] Compile one cluster-mesh provider registry with exact APP-P1 public names for W4.

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
  - `api/vitest.config.ts`
  - `api/tsconfig.json`
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
- [x] BR02-EX2: one workspace artifacts type graph for the new mesh builtin import resolves the conflicting API/private and workspace 0.2.1 frozen types; API typecheck and lint pass. Bounded api/tsconfig.json path mapping; runtime locks remain W2.b; rollback removes mapping.
- [x] BR02-EX1: Vitest root aliases resolve new registry leaves as index.ts/subpath (ENOTDIR). Add exact mesh/platform leaf aliases in api/vitest.config.ts; test-only impact; rollback removes those aliases.
- [x] BR02-EX1 pins all test artifacts imports to workspace dist, matching the mesh loader and keeping HTTP/MCP on one profile instance. Root lock installs an API-private artifacts copy; its profile WeakSet refuses cross-copy profiles. Production physical resolution remains W2.b's required gate.
- [x] W2.b owns route mounting, identity/dispatch integration and root/API lock reconciliation.
- [ ] P2-1 / W2.b acceptance: reconcile root/API locks, then call `compileAppMcpRegistry` successfully in the production image or a strict install without aliases; owner: W2.b author. Remove the following masking lines after reconciliation.
  - [ ] `api/vitest.config.ts:17`: `'@sentropic/artifacts': fileURLToPath(new URL('../packages/artifacts/dist', import.meta.url)),`
  - [ ] `api/tsconfig.json:8`: `"@sentropic/artifacts": ["../packages/artifacts/dist/index.d.ts"],`
  - [ ] `api/tsconfig.json:9`: `"@sentropic/artifacts/*": ["../packages/artifacts/dist/*"]`
- [x] W4 consumes the returned compiled registry exact-name map without sanitization.
- [x] Compiled order: `artifacts_ensure`, `artifacts_get`, `artifacts_list`, `artifacts_publish`.
- [ ] Independent review and final CI receipts remain required; no inherited review approves this diff.

## AI Flaky tests
- [x] No AI calls, accepted flakes or timeout increases.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one author; independent review only at the final commit.

## UAT Management (in orchestration context)
- [x] Compilation only; web/Chrome/VSCode flows belong to W2.b/W4/W5; no UI or E2E changes.

## Plan / Todo (lot-based)
- [x] Lot 0: mechanical branch check; freeze scope, dependencies, environment and contract.
- [x] Lot 1: tests first in `api/tests/api/app-mcp-registry.test.ts`; missing-module red captured in `/tmp/app-w2a-module-red.log` after BR02-EX1.
- [x] Lot 2: implement `api/src/services/mcp/cluster-registry.ts` using mesh modules, builtin and facade.
- [x] Lot 3: same test file covers exact names, explicit selection/config, collisions, missing peers, profile/schema/policy integrity and atomic refusal.
- [x] Lot 4: focused API suite, API typecheck/lint, relevant registry and MCP regressions; cleanup.
  - [x] API typecheck; lint 0 errors/219 warnings; focused registry 17/17: `/tmp/app-w2a-types-coherence.log`, `/tmp/app-w2a-final-focused.log`.
  - [x] API regressions: `api/tests/api/{app-mcp-registry,artifacts-host-publication,artifacts-host-migrations,mcp-resource-server,cluster-mesh-mcp-singleton,cluster-mesh-namespace-inventory}.test.ts`: 74/74, `/tmp/app-w2a-regressions.log`.
  - [x] Consumed mesh registry suite: `packages/cluster-mesh/tests/mcp-registry.spec.ts`: 4/4, `/tmp/app-w2a-mesh-registry.log`.
  - [x] API stack reached healthy before tests; all steps cleaned with locked make down; final make ps has no services. No AI calls or skips.
- [x] Lot 5 authoring: push and draft PR #785 against `feat/app-cm-integration`; PR body is this file; no merge.
  - [ ] Exact-head remote CI receipt: workflow_dispatch required for this integration base; confirm success in the PR before acceptance.
  - [ ] Independent review dispatch awaits owner OK required by `rules/subagents.md`; no reviewer verdict or consensus claimed.
- [x] Lot 6 / P1-1: enforce W0-close.d #702 `5dfab2cf3:docs/baselines/app-cm-w0/published-tuple-2026-10-26.json` profile pin `0de19f966eacb5b63142b525611a6210a0d4aaeefbdaad92dfb3b6227575b6ef`; require explicit compatibility receipts and refuse installed schema/policy drift.
  - [x] Red: unchanged names plus drifted list schema compiled successfully, and a missing receipt compiled successfully; 17/19 pass, two regressions fail in `/tmp/app-w2a-r1-red3.log`.
  - [x] artifacts 0.2.1 APP-P1 manifest with `mcp:tools:invoke` qualified as `ccf8a4ddd9365537741eb0550efa49954d86a0c2d1ee808fb18ca81ef7090e9a` in that run; freeze this literal independently of runtime definitions.
  - [x] Green: `make test-api-unit SCOPE=tests/api/app-mcp-registry.test.ts API_PORT=8794 UI_PORT=5180 MAILDEV_UI_PORT=1087 ENV=test-app-w2a` 19/19; `make typecheck-api`, `make lint-api` (0 errors/219 warnings), scope C2 pass in `/tmp/app-w2a-r1-canonical.log`; all run under the shared Docker lock.
  - [x] Locked `make logs-api down ps` completed; API startup logged without runtime errors and no services remain: `/tmp/app-w2a-r1-cleanup.log`.

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
