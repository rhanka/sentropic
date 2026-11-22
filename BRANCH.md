# Feature: Claude 5.5 catalog profiles and multi-seat effort audit

## Objective
Add real Claude 5.5 catalog profiles (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`) on the `anthropic` / `claude-code` seat without breaking gateway alias routing, wire per-request effort validation and forwarding on `claude-code`, and audit and fix effort mappings across all twelve target models.

## Scope / Guardrails
- Scope limited to `@sentropic/llm-mesh`, council source, impacted `api` catalog/native tests, and release version/lockfile sync (`0.38.8`).
- Make-only workflow, no direct npm/node/docker on the host.
- Isolated worktree `tmp/llm-mesh-claude-55` on branch `feat/llm-mesh-claude-55`.
- Ports `API_PORT=9212 UI_PORT=5412 MAILDEV_UI_PORT=1312` with `ENV=test-mesh-c55` always last.
- All code, tests, commits, and PR text in English; no AI attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/**`
  - `scripts/llm-model-equivalences/council.source.json`
  - `api/tests/api/models.test.ts`
  - `api/tests/api/cluster-mesh-gw-native.test.ts`
  - `api/tests/api/gw-count-tokens.test.ts`
  - `api/tests/unit/claude-provider.test.ts`
  - `api/tests/unit/gateway-route-plane-native.test.ts`
  - `api/tests/unit/llm-runtime-stream.test.ts`
  - `package-lock.json`
  - `packages/cluster-mesh/tests/fixtures/train.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`

## Feedback Loop
- `acknowledge`: PR #1070 claims `@sentropic/llm-mesh@0.38.7`, so this branch bumps `@sentropic/llm-mesh` to `0.38.8` above both `main` (`0.38.6`) and PR #1070 (`0.38.7`).

## AI Flaky tests
- No live AI provider tests executed; all tests use deterministic fakes and fixtures.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single cohesive package evolution)
- [ ] **Multi-branch**
- Rationale: All changes belong to one cohesive `@sentropic/llm-mesh` 0.38.8 release with aligned catalog, transport effort mapping, and consumer test fixtures.

## UAT Management (in orchestration context)
- Package and transport change only; no browser UI surface impacted.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, and `plan/BRANCH_TEMPLATE.md`.
  - [x] Create isolated worktree `tmp/llm-mesh-claude-55` on `feat/llm-mesh-claude-55` from `origin/main`.
  - [x] Verify `claude`, `agy`, `muse`, `codex`, and `vibe` effort support and audit gateway alias collision.
  - [x] Confirm ports `API_PORT=9212 UI_PORT=5412 MAILDEV_UI_PORT=1312` and `ENV=test-mesh-c55`.
- [x] **Lot 1 — Claude 5.5 catalog profiles and gateway alias collision decoupling**
  - [x] Add `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` to `providers.ts`, `catalog.ts`, and `council.source.json` + regenerate `generated-model-council.ts`.
  - [x] Add `GATEWAY_ALIAS_ONLY_CLAUDE_MODEL_IDS` guard in `routing-targets.ts` and `route-selection.ts` so gateway launch aliases stay unchanged while direct `anthropic:claude-*-5-5` seat routing works.
  - [x] Add `supportedEfforts` metadata to audited catalog profiles (`gemini-4-*`, `gpt-6-luna`, `mistral-large-4`, `zai-glm-5-3`, `muse-wonder-1.0`, `muse-ember-1.0`, `claude-*-5-5`).
  - [x] Update catalog, council, routing, and impacted `api` unit/API fixture tests.
- [x] **Lot 2 — Per-seat effort mapping fixes (test-first)**
  - [x] `claude-code` (`ClaudeCodeRuntimeClient`, `NodeClaudeCodeCliRunner`): forward validated per-request `effort` to `--effort` and reject unsupported efforts (`none`, unknown, or disallowed per profile) before spawning with a clear error.
  - [x] `cloud-code` (`CloudCodeRuntimeClient`): map `max` to `XHIGH` (`-xhigh`) for `CLOUD_CODE_XHIGH_MODEL_IDS` (`gemini-4-neon`, `gemini-4-hydrogen`) while keeping `HIGH` clamp for `gemini-4-argon` and `gemini-4-carbon`.
  - [x] `muse` (`MuseRuntimeClient`): project validated effort-only `reasoning: { effort }` on `/v1/responses` while rejecting `none` and unsupported fields (`summary`, `enabled`, `budgetTokens`) fail-closed before I/O.
  - [x] `mistral-vibe` (`MistralRuntimeClient`): clamp `mistral-large-4` (`xhigh`/`max` -> `high`) and `zai-glm-5-3` (`medium` -> `low`, `xhigh` -> `high`) to model-supported efforts; add `'max'` to `CodexReasoningEffort`.
- [ ] **Lot 3 — Version 0.38.8, validation gates, and PR**
  - [x] Bump `@sentropic/llm-mesh` to `0.38.8`, update `CHANGELOG.md`, `decision-public-surface.test.ts`, lockfiles, and `cluster-mesh` fixtures.
  - [x] Run `make check-llm-model-equivalences`, `make typecheck-llm-mesh`, `make lint-llm-mesh`, `make build-llm-mesh`, `make test-llm-mesh`, `make typecheck-llm-gateway`, `make test-llm-gateway`, and `make scope-check` with `ENV=test-mesh-c55`.
  - [ ] Push `feat/llm-mesh-claude-55`, open PR, and wait for CI green on exact HEAD without merging.
