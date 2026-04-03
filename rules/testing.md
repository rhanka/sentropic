---
description: "Test pyramid, CI strategy, environment isolation, AI flaky rules"
alwaysApply: false
paths: ["api/tests/**", "ui/tests/**", "e2e/**", "**/*.test.*", "**/*.spec.*"]
globs: ["api/tests/**", "ui/tests/**", "e2e/**", "**/*.test.*", "**/*.spec.*"]
tags: [testing]
---

# TESTING STRATEGY

## Principles
- Test behavior, not implementation — focus on what users see/do
- Descriptive names: "should [behavior] when [condition]"
- Query by user-visible elements (text, roles, labels) over test IDs
- Keep tests isolated and repeatable
- Pyramid: 70% unit, 20% integration, 10% E2E

## Quality Gates
- All non-AI tests must pass before merge
- AI flaky allowlist: non-blocking when documented with failure signature + user sign-off
- Security tests must pass before merge
- Unit coverage: minimum 70%
- No critical vulnerabilities without documented context

## Main Test Commands
On TARGET=development:
- `make test-ui [SCOPE=tests/test.ts] ENV=test` — UI unit tests (Vitest)
- `make test-api [SCOPE=tests/test.ts] ENV=test` — API unit + integration (Vitest)

On TARGET=production (requires `make build-api build-ui-image` first):
- `make test-e2e [E2E_SPEC=tests/test.ts] API_PORT=<port> UI_PORT=<port> MAILDEV_UI_PORT=<port> ENV=e2e`

### API Test Suites
- `make test-api-smoke [SCOPE=...]` — smoke tests
- `make test-api-endpoints [SCOPE=...]` — CRUD tests
- `make test-api-ai [SCOPE=...]` — AI generation tests
- `make test-api-queue [SCOPE=...]` — queue job tests
- `make test-api [SCOPE=...]` — all API tests (without E2E)

## AI Flaky Allowlist (Non-blocking)
- API: `make test-api-ai`, `api/tests/ai/**`
- E2E: `e2e/tests/00-ai-generation.spec.ts`, `e2e/tests/03-chat.spec.ts`, `e2e/tests/03-chat-chrome-extension.spec.ts`, `e2e/tests/07_comment_assistant.spec.ts`
- Acceptance: failure signature indicates provider/network/model nondeterminism
- Must record exact command + failing file + failure signature in `BRANCH.md`
- User sign-off required before merge

## Environment Isolation Rules (MANDATORY)
- User UAT/dev on root workspace only: `~/src/top-ai-ideas-fullstack` with `ENV=dev`
- Branch changes in isolated worktrees: `tmp/feat-<slug>`
- Never run test campaigns on root `dev`:
  - API/UI tests: `ENV=test` or branch-specific env
  - E2E tests: `ENV=e2e`, isolated ports, isolated compose project
- During UAT: code/test in `tmp/feat-<slug>`, push, switch to root for UAT, switch back
- `ENV` must be the last argument in all `make` commands

## Branch Workflow Alignment
- Defer full test runs until end of branch
- Before UAT lot: `make typecheck-<ui/api>` + `make lint-<ui/api>`
- While developing a test, run only the test under evolution:
  - API: `make test-api-<suite> SCOPE=tests/your-file.spec.ts`
  - UI: `make test-ui SCOPE=tests/your-file.spec.ts`
  - E2E: `make test-e2e E2E_SPEC=tests/your-file.spec.ts`
- Full gates at end: `make test-api`, `make test-ui`, `make clean test-e2e`
- E2E requires `make build-api build-ui-image` first
- Between E2E passes: `make clean ... ENV=e2e` -> `make test-e2e ... ENV=e2e` -> `make clean ... ENV=e2e`
- UI testing scope: TypeScript tests only (`ui/tests/**/*.ts`), no Svelte component tests
- Respect existing test structure (`api/tests/**`, `e2e/tests/**`)

## Testing Levels

### Unit Tests
- Scope: individual functions, classes, components, mock tests
- Environment: isolated, no external dependencies
- Frameworks: Vitest for UI (SvelteKit) and API (Hono)

### Integration Tests
- Scope: API endpoints, DB operations, queue processing, AI service integration
- Environment: API service with SQLite database
- File structure: `api/tests/` with organized suites

### End-to-End Tests
- Scope: full user workflows across UI and API
- Environment: complete stack via Docker Compose
- Framework: Playwright for browser automation

## CI Pipeline (High-Level)
1. Build images (Docker Compose) + dependency audits
2. In parallel: unit tests + code quality (`lint`, `typecheck`, `format-check`)
3. After unit pass: API integration tests
4. After integration: E2E tests

## Future Security Tests
- `make test-security-sast`, `make test-security-sca`, `make test-security-container`
- `make test-security` (all scans)

> WARNING: NEVER test on ENV=dev — afterEach hooks purge real data. 2026-03-14: chat messages destroyed. 2026-03-20: subagent purged dev data again. Use dedicated test ENV only.

> WARNING: NEVER increase E2E timeouts — masks bugs. UI is reactive, waits should be <2s except AI generation. Timeout failure = real bug (bad selector, race condition, regression).
