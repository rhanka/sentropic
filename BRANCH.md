# Feature: WP16 Layer-A Claude Code account auth material

## Objective
Promote Claude Code account transport to a first-class Sentropic llm-mesh/API auth path so Anthropic runtime calls can use explicit Claude Code account credentials without overloading token credentials.

## Scope / Guardrails
- Scope limited to llm-mesh provider catalog/auth material, API runtime dispatch/account transport integration, generated chat-app catalog templates, and focused tests.
- Make-only workflow: no direct npm/docker test commands for validation.
- Automated test campaigns must run on dedicated environments (`ENV=test-*`), never root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/chat-service.ts`
  - `api/src/services/llm-runtime/index.ts`
  - `api/src/services/llm-runtime/mesh-dispatch.ts`
  - `api/src/services/model-selection-legacy.ts`
  - `api/src/services/provider-connections.ts`
  - `api/tests/api/models.test.ts`
  - `api/tests/unit/claude-provider.test.ts`
  - `api/tests/unit/llm-runtime-stream.test.ts`
  - `api/tests/unit/model-selection-legacy.test.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/src/adapter-auth.ts`
  - `packages/llm-mesh/src/catalog.ts`
  - `packages/llm-mesh/src/providers.ts`
  - `packages/llm-mesh/tests/auth.test.ts`
  - `packages/llm-mesh/tests/facade.test.ts`
  - `packages/build-cli/templates/chat-app/package.json`
  - `packages/build-cli/templates/chat-app/ui/package.json`
  - `packages/build-cli/tests/fixtures/chat-app-golden.json`
  - `packages/build-cli/tests/generator-golden.spec.ts`
  - `packages/build-cli/tests/init.spec.ts`
  - `package-lock.json`
  - `BRANCH.md`
  - `.track/events.jsonl`
  - `.track/head.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - unrelated packages/specs/plans
- **Exception process**:
  - Declare exception ID in `## Feedback Loop` before touching conditional/forbidden paths.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `clarification`: package source changes require the PR to bump `packages/<pkg>/package.json`; CI enforces the bump and later publishes the declared version, it does not increment the version itself.
- `separate-branch`: 2026-07-08 h2a urgent gateway/Codex trimming ownership request is acknowledged as a separate branch/PR and is intentionally not implemented here.
- `resolved`: API Make gates are green on PR run `28992129718`; the earlier API failures were resolved by commits `807a5f4fc` and `f50fcf7e5`.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`; if related, treat as blocking.
  - Capture explicit owner sign-off before merge.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Confirm Make-only validation workflow.
  - [x] Confirm package source change requires package version bump.
  - [x] Keep h2a gateway/Codex trimming request out of this branch.

- [x] **Lot 1 — llm-mesh Claude Code account auth material**
  - [x] Add/verify first-class `claude-code-account` auth material validation.
  - [x] Add Anthropic OAuth beta header for Claude Code account material.
  - [x] Update Anthropic catalog IDs to current Claude model names.
  - [x] Bump `@sentropic/llm-mesh` patch version to `0.6.1` and update lockfile.
  - [x] Focused llm-mesh validations:
    - [x] `make typecheck-llm-mesh ENV=test-wp16-layer-a-claude-code-account`
    - [x] `make build-llm-mesh ENV=test-wp16-layer-a-claude-code-account`
    - [x] `make test-llm-mesh ENV=test-wp16-layer-a-claude-code-account` — 6 files / 35 tests passed.

- [x] **Lot 2 — API runtime integration**
  - [x] Add Claude Code connected transport resolution seam.
  - [x] Add Anthropic transport mode selection for Claude Code vs token.
  - [x] Pass `claude-code-account` auth override through mesh dispatch.
  - [x] Record account transport outcomes for success/failure/rate-limit/auth-failure paths.
  - [x] Update model catalog and focused API tests for renamed Claude models.

- [x] **Lot 3 — build-cli generated catalog parity**
  - [x] Update generated chat-app template package pins and golden fixtures impacted by catalog/package version changes.

- [x] **Lot N — Final validation**
  - [x] Scope check run after scope update.
  - [x] llm-mesh package gates passed.
  - [x] API typecheck/lint/scoped unit gates passed on CI run `28992129718`.
  - [x] `make test-api-unit SCOPE=tests/unit/llm-runtime-stream.test.ts ENV=test-wp16-layer-a-claude-code-account` — 66 passed, 1 skipped.
  - [x] Final branch commits pushed through `f50fcf7e5`.
  - [x] PR #387 open, non-draft, `mergeStateStatus=CLEAN`, CI green on run `28992129718`.
