# Feature: llm-mesh Gemini static-key fallback client

## Objective
Add a minimal generic static-key Gemini client to @sentropic/llm-mesh so immo can select it as fallback when the Gemini seat answers quota/rate_limited.

## Scope / Guardrails
- Scope limited to a new Gemini GenerateContent runtime client, its package export, unit tests, patch bump, CHANGELOG, lockfiles.
- No budget admission, no alerting, no gateway changes in this lane (Lot 5 lane s-muse-llm-mesh-lot5 builds on top).
- One migration max in `api/drizzle/*.sql` (not applicable, none).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/llm-mesh-gemini-min`.
- Automated test campaigns must run on dedicated environments (`ENV=test-llm-mesh-gemini-min`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=test-llm-mesh-gemini-min` must be passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/transport/gemini-api-key-runtime-client.ts`
  - `packages/llm-mesh/src/index.ts`
  - `packages/llm-mesh/tests/transport/gemini-api-key-runtime-client.test.ts`
  - `packages/llm-mesh/tests/decision-public-surface.test.ts` (version pin only)
  - `packages/llm-mesh/package.json` (patch bump only)
  - `packages/llm-mesh/CHANGELOG.md`
  - `package-lock.json` (regenerated llm-mesh version entry only)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- No open items.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single minimal change, one package, one CI run.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this lane, no UAT required.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `.tmp/packets/COMMON-RULES.md`, plan Lot 5.
  - [x] Create isolated worktree `tmp/worktrees/llm-mesh-gemini-min` on branch `feat/llm-mesh-gemini-apikey-client` from `origin/main` and verify with `git branch --show-current`.
  - [x] Define environment mapping: `ENV=test-llm-mesh-gemini-min`, `API_PORT=8917`, `UI_PORT=5317`, `MAILDEV_UI_PORT=1217`.
  - [x] Confirm command style: `make ... ENV=test-llm-mesh-gemini-min` with `ENV` last; Docker via `.tmp/packets/docker-slot.sh make ...` in the foreground.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`); no exceptions needed.
- [ ] **Lot 1 — Static-key Gemini runtime client**
  - [x] Add `packages/llm-mesh/src/transport/gemini-api-key-runtime-client.ts` wire projection (request shape, systemInstruction, tools, generationConfig).
  - [x] Add response extraction and typed failure mapping (429 rate_limited, 402 billing_unavailable, 401/403 auth_failed).
  - [x] Add `GeminiApiKeyRuntimeClient` + `createGeminiApiKeyClient` factory, export from package index for `geminiClient` injection.
  - [x] Add stubbed-fetch unit tests part 1 (request shape, header, systemInstruction, 429 mapping).
  - [x] Add stubbed-fetch unit tests part 2 (402 billing, 401/403 auth, key secrecy, stream).
  - [ ] Export the client and its factory from `packages/llm-mesh/src/index.ts` for use as `geminiClient` injection.
  - [ ] Add `packages/llm-mesh/tests/transport/gemini-api-key-runtime-client.test.ts` with stubbed fetch: request shape, header present, error mapping (429, 402, 401), no key in error messages.
  - [ ] Lot gate:
    - [ ] `make typecheck-llm-mesh ENV=test-llm-mesh-gemini-min`
    - [ ] `make lint-llm-mesh ENV=test-llm-mesh-gemini-min`
    - [ ] **API tests**
      - [ ] No API changes.
    - [ ] **UI tests (TypeScript only)**
      - [ ] No UI changes.
    - [ ] **E2E tests**
      - [ ] No E2E changes (no user-visible surface).
- [x] **Lot 2 — Version, changelog, locks, immo compat**
  - [x] Patch bump `packages/llm-mesh/package.json` above npm latest (`0.33.0`).
  - [x] Update `packages/llm-mesh/tests/decision-public-surface.test.ts` version pin.
  - [x] Update `packages/llm-mesh/CHANGELOG.md` under Unreleased.
  - [x] Regenerate lockfiles through make (root `package-lock.json` llm-mesh version entry; unrelated `ui/package-lock.json` churn reverted).
  - [x] Verify immo `refresh-mesh.ts` imports (`DEFAULT_ROUTE_POLICY`, `InMemoryRoutePolicyProfiles`, `OpenAIAdapter`, `CloudCodeRuntimeClient`, `CodexRuntimeClient`, `createLlmMeshFacade`, facade types) still resolve: drop-in (report states exact immo wiring).
  - [ ] Lot gate: `make scope-check ENV=test-llm-mesh-gemini-min`.
- [x] **Lot 3 — Final validation**
  - [x] Typecheck & Lint (cf Lot 1): both green on the final head via `docker-slot.sh`.
  - [x] Scoped package tests: `make test-llm-mesh SCOPE=tests/transport/gemini-api-key-runtime-client.test.ts ENV=test-llm-mesh-gemini-min` 8/8 green; `SCOPE=tests/decision-public-surface.test.ts` 4/4 green.
  - [x] No AI flaky tests introduced (stubbed fetch only).
  - [x] Bumped `packages/llm-mesh/package.json` 0.33.0 -> 0.33.1 (enforced by CI `enforce-package-bump`).
  - [ ] Final gate step 1: create PR with `BRANCH.md` text as body.
  - [ ] Final gate step 2: run/verify branch CI on that PR, no rerun/skip; AI e2e flake goes to `BRANCH.md` note + fresh head.
  - [ ] Final gate step 3: DO NOT merge (conductor merges); no external review (conductor runs it).
