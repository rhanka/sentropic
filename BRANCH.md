# Feature: Transfer session sticky & routing logic from h2a to llm-gateway

## Objective
Move the account selection, sticky session persistence, and HTTP 429 failover/rebind logic currently implemented in h2a-runtime into `@sentropic/llm-gateway` (and `@sentropic/llm-mesh` where appropriate). After this, h2a serves only as a minimal launcher that injects configuration into the gateway.

## Scope / Guardrails
- Scope limited to `packages/llm-gateway/`, `packages/llm-mesh/`, and their tests.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/feat-gw-session-routing`.
- Automated test campaigns run on dedicated environments (`ENV=test-gw-session` / `ENV=e2e-gw-session`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-gateway/src/**`
  - `packages/llm-gateway/tests/**`
  - `packages/llm-gateway/package.json`
  - `packages/llm-mesh/src/**`
  - `packages/llm-mesh/tests/**`
  - `packages/llm-mesh/package.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/src/services/**` (if gateway integration requires api-side wiring)
  - `api/tests/**` (if gateway integration requires api-side test updates)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BR-GW-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
_(empty — will be populated as needed)_

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
- Non-systematic means at least one success on the same commit and same command.
- Never amend tests with additive timeouts.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: Single feature transfer, all changes are cohesive and confined to llm-gateway/llm-mesh packages.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read h2a-runtime source to catalog the exact logic to transfer: `selectAccount`, `sticky.ts`, failover 429 rebind.
  - [ ] Create/confirm isolated worktree `tmp/feat-gw-session-routing` and run development there.
  - [ ] Capture Makefile targets needed for debug/testing.
  - [ ] Define environment mapping: `test-gw-session`, `e2e-gw-session`.
  - [ ] Confirm scope and guardrails.
  - [ ] Validate scope boundaries and declare exceptions if needed.

- [ ] **Lot 1 — Sticky session middleware in llm-gateway**
  - [ ] Design pluggable storage interface for session affinity (file, memory, Redis, K8s ConfigMap).
  - [ ] Implement sticky session middleware/helper in `packages/llm-gateway/src/`.
  - [ ] Implement in-memory and file-based storage adapters.
  - [ ] Lot gate:
    - [ ] `make typecheck-api` + `make lint-api`
    - [ ] **Package tests**
      - [ ] Add unit tests for sticky session logic in `packages/llm-gateway/tests/`.
      - [ ] Sub-lot gate: `make test-api ENV=test-gw-session`

- [ ] **Lot 2 — Account pool & round-robin selection in llm-gateway**
  - [ ] Transfer `selectAccount` logic from h2a-runtime into `packages/llm-gateway/src/`.
  - [ ] Implement round-robin / pool management with configurable strategy.
  - [ ] Lot gate:
    - [ ] `make typecheck-api` + `make lint-api`
    - [ ] **Package tests**
      - [ ] Add unit tests for account selection in `packages/llm-gateway/tests/`.
      - [ ] Sub-lot gate: `make test-api ENV=test-gw-session`

- [ ] **Lot 3 — HTTP 429 failover & rebind in llm-gateway**
  - [ ] Transfer failover detection and automatic rebind on 429 from h2a-runtime.
  - [ ] Implement retry policy with exponential backoff and account rotation.
  - [ ] Lot gate:
    - [ ] `make typecheck-api` + `make lint-api`
    - [ ] **Package tests**
      - [ ] Add unit tests for 429 failover in `packages/llm-gateway/tests/`.
      - [ ] Sub-lot gate: `make test-api ENV=test-gw-session`

- [ ] **Lot 4 — Integration & h2a simplification**
  - [ ] Wire the new gateway helpers into the existing passthrough flow.
  - [ ] Verify h2a can instantiate the gateway with minimal configuration.
  - [ ] Lot gate:
    - [ ] `make typecheck-api` + `make lint-api`
    - [ ] **API tests**
      - [ ] Evolve existing gateway tests to cover new routing paths.
      - [ ] Sub-lot gate: `make test-api ENV=test-gw-session`
    - [ ] **E2E tests**
      - [ ] Prepare E2E build: `make build-api build-ui-image API_PORT=9020 UI_PORT=5220 MAILDEV_UI_PORT=1120 ENV=e2e-gw-session`
      - [ ] Sub-lot gate: `make clean test-e2e API_PORT=9020 UI_PORT=5220 MAILDEV_UI_PORT=1120 ENV=e2e-gw-session`

- [ ] **Lot 5 — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest API
  - [ ] Retest E2E
  - [ ] Bumped `packages/llm-gateway/package.json` and `packages/llm-mesh/package.json` versions.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run/verify branch CI and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
