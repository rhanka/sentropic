# Feature: llm-mesh — add GPT-6.2 Sol and map Opus 5.5 to it

## Objective
Add GPT-6.2 Sol (`gpt-6.2-sol`) to `@sentropic/llm-mesh` (catalog, providers, routing target, equivalence council), map every `claude-opus-5-5` alias to `codexModel: 'gpt-6.2-sol'`, bump `@sentropic/llm-mesh` to `0.38.5`, and refresh consumer lockfiles and fixtures.

## Scope / Guardrails
- Scope limited to `@sentropic/llm-mesh`, `@sentropic/llm-gateway` routing tests, equivalence council source, API catalog tests, cluster-mesh train/packaging fixtures, root lockfile, and routing specs.
- Make-only workflow, no direct Docker/npm/node/python commands.
- Worktree `tmp/llm-mesh-sol62` on branch `feat/llm-mesh-sol-6-2`, `ENV=test-sol62`, `API_PORT=9198`, `UI_PORT=5398`, `MAILDEV_UI_PORT=1298`.
- `ENV=test-sol62` passed as last argument to every `make` command.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/**`
  - `packages/llm-gateway/tests/target.test.ts`
  - `scripts/llm-model-equivalences/council.source.json`
  - `api/tests/api/models.test.ts`
  - `api/tests/unit/llm-runtime-stream.test.ts`
  - `packages/cluster-mesh/tests/fixtures/train.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `package-lock.json`
  - `spec/SPEC_EVOL_LLM_MESH.md`
  - `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`

## Feedback Loop
- None.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single focused worktree branch)
- [ ] **Multi-branch**
- Rationale: Single cohesive model catalog addition and routing update.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Verify branch `feat/llm-mesh-sol-6-2` in `tmp/llm-mesh-sol62`.
  - [x] Verify `gpt-6.2-sol` effort levels and context window from OpenAI docs and Codex CLI model cache.
  - [x] Audit published versions via `make audit-llm-routing-package-versions ENV=test-sol62`.

- [x] **Lot 1 — Tests first & GPT-6.2 Sol catalog + Opus 5.5 routing**
  - [x] Update `packages/llm-mesh/tests/routing-targets.test.ts`, `equivalence-council.test.ts`, `budget-quote.test.ts`, `service/local-account-transport-service.test.ts`, `packages/llm-gateway/tests/target.test.ts`, `api/tests/api/models.test.ts`, `api/tests/unit/llm-runtime-stream.test.ts`.
  - [x] Add `gpt-6.2-sol` to `packages/llm-mesh/src/catalog.ts`, `providers.ts`, `routing-targets.ts`.
  - [x] Map all 6 `claude-opus-5-5` aliases to `codexModel: 'gpt-6.2-sol'` in `packages/llm-mesh/src/routing-targets.ts`.
  - [x] Add `openai:gpt-6.2-sol` to `scripts/llm-model-equivalences/council.source.json` and run `make refresh-llm-model-equivalences ENV=test-sol62`.

- [ ] **Lot 2 — Version bump (0.38.5), CHANGELOG, specs, lockfiles & fixtures**
  - [ ] Bump `packages/llm-mesh/package.json` to `0.38.5`, update `packages/llm-mesh/CHANGELOG.md`, `tests/decision-public-surface.test.ts`, and routing specs.
  - [ ] Regenerate root `package-lock.json` via `make lock-root ENV=test-sol62`.
  - [ ] Update `packages/cluster-mesh/tests/fixtures/train.ts` and `selected/package.json` + regenerate `selected/package-lock.json` via Make targets.

- [ ] **Lot 3 — Final validation & PR**
  - [ ] Run `make build-llm-mesh`, `make typecheck-llm-mesh`, `make lint-llm-mesh`, `make test-llm-mesh`, `make check-llm-model-equivalences`, `make test-llm-gateway`, `make audit-llm-routing-package-versions`, `make scope-check` (all `ENV=test-sol62`).
  - [ ] Remove `BRANCH.md` before final push and open PR.
  - [ ] Wait for CI green on exact head.
