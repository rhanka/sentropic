# Feature: llm-gateway L1.3d — secretlint host adapter (SCA-gated)

## Objective
Implement Sub-Lot L1.3d of the gateway relay chain: a dedicated SCA-gated host adapter behind `SecretScannerPort` using `@secretlint/*` (`preset-recommend`, 28 rules) and `js-yaml@^3.15.2` (`yaml.safeLoad` with `JSON_SCHEMA`) in `api` and `apps/llm-gateway`, keeping `@sentropic/llm-gateway` zero-third-party-dep.

## Scope / Guardrails
- Scope limited to `api` and `apps/llm-gateway` host adapters, tests, manifests, and root `package-lock.json` (`BR-GWRC-EX5`).
- Make-only workflow, no direct Docker/npm/node on host; `ENV=test-gw-l13d` last.
- Isolated worktree `tmp/gw-relay-l13d` on `feat/gw-relay-l13d` with `API_PORT=9198 UI_PORT=5398 MAILDEV_UI_PORT=1298`.
- Never call `yaml.load` (`yaml.safeLoad(..., { schema: yaml.JSON_SCHEMA })` only); bound input sizes; no secret value in logs or messages.
- Gateway default behavior remains byte-identical when guard is not configured.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/package.json`
  - `apps/llm-gateway/package.json`
  - `package-lock.json`
  - `api/src/services/llm-runtime/**`
  - `api/src/routes/namespaces/gw.ts`
  - `api/tests/unit/**`
  - `apps/llm-gateway/src/**`
  - `apps/llm-gateway/tests/**`
  - `.security/vulnerability-register.yaml`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `rules/**`
  - `deploy/**`
  - `package.json`
  - `packages/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json` (`BR-GWRC-EX5`)
- **Exception process**:
  - `BR-GWRC-EX5` declared below under `## Feedback Loop`.

## Feedback Loop
- `BR-GWRC-EX5` (`package-lock.json`, paired with `api/package.json` and `apps/llm-gateway/package.json`):
  - `acknowledge`: Owner GO `GO-SCA-SECRETLINT` granted 2026-11-21 for `@secretlint/{core,secretlint-rule-preset-recommend,types}@^13.0.2` and `js-yaml@^3.15.2` (plus `@types/js-yaml@^3.12.9` devDependency) with SCA gate (`make test-security-sca-gate` and `make test-security-sca`).
  - Reason: `@secretlint/core`, `@secretlint/secretlint-rule-preset-recommend` (28 rules, pure-JS MIT), `@secretlint/types`, and `js-yaml@^3.15.2` (`yaml.safeLoad` aligned with root override `package.json:30`) are required runtime dependencies for the L1.3d host adapter while `@sentropic/llm-gateway` stays zero-third-party-dep.
  - Impact: Adds pure-JS MIT `@secretlint/*` packages and explicit `js-yaml@^3.15.2` dependency to `api` and `apps/llm-gateway` lockfile closure; zero native addon (`better-sqlite3` excluded); gated by `npm audit` and SCA gates.
  - Rollback: Revert `BR-GWRC-EX5` commit; `GuardEngine` continues using built-in + L1.3c pure-TS `PureSecretScanner`.

## AI Flaky tests
- None expected; all L1.3d tests are deterministic unit and router tests with synthetic fixtures.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single focused sub-lot PR)
- [ ] **Multi-branch**
- Rationale: Single sub-lot L1.3d in isolated worktree `tmp/gw-relay-l13d`.

## UAT Management (in orchestration context)
- No UI changes; automated unit, integration, typecheck, lint, build, and SCA gates cover the full scope.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `rules/security.md`, `.tmp/packets/COMMON-RULES.md`, and `spec/SPEC_EVOL_LLM_GW_RELAY_CHAIN.md` (L1.3d).
  - [x] Create isolated worktree `tmp/gw-relay-l13d` on `feat/gw-relay-l13d` from `origin/main`.
  - [x] Confirm environment mapping `ENV=test-gw-l13d`, `API_PORT=9198`, `UI_PORT=5398`, `MAILDEV_UI_PORT=1298`.
  - [x] Declare `BR-GWRC-EX5` (`GO-SCA-SECRETLINT`) scope exception.

- [x] **Lot 1 — Dependencies & SCA gate (`BR-GWRC-EX5`)**
  - [x] Install `@secretlint/core@^13.0.2`, `@secretlint/secretlint-rule-preset-recommend@^13.0.2`, `@secretlint/types@^13.0.2`, `js-yaml@^3.15.2`, and dev `@types/js-yaml@^3.12.9` into `api` and `apps/llm-gateway` via `make` targets inside Docker.
  - [x] Verify exact lockfile pins in `package-lock.json` and zero modification to root `package.json` and `packages/**`.
  - [x] Run `make test-security-sca-gate ENV=test-gw-l13d` and `make test-security-sca ENV=test-gw-l13d`.

- [ ] **Lot 2 — API host adapter (`api/src/services/llm-runtime/secretlint-scanner-adapter.ts` + `gw.ts`)**
  - [x] Red: write failing `api/tests/unit/secretlint-scanner-adapter.test.ts` covering 28-rule preset-recommend synthetic fixtures, `yaml.safeLoad` (`JSON_SCHEMA`) + `!!js/function` rejection, input size bounds, no secret echo in messages/errors, disjoint `dedupeRanges` merge with `KUBECONFIG_PATTERNS`, and 3-wire `P` refusal (`400`, zero dispatch).
  - [ ] Green: implement `api/src/services/llm-runtime/secretlint-scanner-adapter.ts` and wire optional `guard`/`secretlint` in `api/src/routes/namespaces/gw.ts` (byte-identical default).
  - [ ] Gate: `make test-api-unit SCOPE=secretlint-scanner-adapter ENV=test-gw-l13d`, `make typecheck-api ENV=test-gw-l13d`, `make lint-api ENV=test-gw-l13d`.

- [ ] **Lot 3 — Standalone host adapter (`apps/llm-gateway/src/secretlint-scanner-adapter.ts` + `app.ts`)**
  - [ ] Red: write failing `apps/llm-gateway/tests/secretlint-scanner-adapter.test.ts` covering 28-rule preset-recommend synthetic fixtures, `yaml.safeLoad` (`JSON_SCHEMA`) + `!!js/function` rejection, input size bounds, no secret echo, disjoint `dedupeRanges` merge with `KUBECONFIG_PATTERNS`, and 3-wire `P` refusal (`400`, zero dispatch) through `createHostApp`.
  - [ ] Green: implement `apps/llm-gateway/src/secretlint-scanner-adapter.ts` (zero runtime import from `@sentropic/llm-gateway`) and wire optional `guard`/`secretlint` in `apps/llm-gateway/src/app.ts` (byte-identical default).
  - [ ] Gate: `make test-llm-gateway-process ENV=test-gw-l13d`, `make typecheck-llm-gateway-process ENV=test-gw-l13d`, `make lint-llm-gateway-process ENV=test-gw-l13d`.

- [ ] **Lot 4 — Final validation & PR**
  - [ ] Run full local gates (`test-api-unit`, `test-llm-gateway-process`, `typecheck-api`, `lint-api`, `typecheck-llm-gateway-process`, `lint-llm-gateway-process`, `api` build check, `test-security-sca-gate`, `test-security-sca`, `scope-check`).
  - [ ] Tear down stack with `make down-volumes ENV=test-gw-l13d` (and `make clean` if applicable).
  - [ ] Remove `BRANCH.md` before final push so no `BRANCH.md` remains in the PR tree.
  - [ ] Push `feat/gw-relay-l13d`, open PR with `BR-GWRC-EX5` declared and no AI attribution trailers, wait for CI green on exact head, do not merge.
