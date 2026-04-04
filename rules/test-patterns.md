---
description: "Test writing patterns — API auth helpers, E2E storage state, cleanup, make targets"
alwaysApply: false
paths: ["api/tests/**", "ui/tests/**", "e2e/**"]
globs: ["api/tests/**", "ui/tests/**", "e2e/**"]
tags: [testing, patterns]
---

# Test Patterns

## API Tests (`api/tests/`)

- **Setup/teardown**:
  - `beforeEach`: call `createAuthenticatedUser('role')` to get a test user + token.
  - `afterEach`: call `cleanupAuthData()` to remove test artifacts.
- **Cleanup scope**:
  - Multi-worker runs: `TEST_CLEANUP_SCOPE=tracked` (only clean data created by this worker).
  - Single-worker runs: `TEST_CLEANUP_SCOPE=global` (full cleanup).
- **HTTP requests**: use `authenticatedRequest(app, 'GET', '/api/v1/...', token)`.
  - Never use raw `fetch` — the helper handles headers and base URL.
- **Unique test data**: use `createTestId()` which produces `timestamp + random` suffix.
  - Prevents collisions in parallel test runs.
- **Reference file**: `api/tests/api/admin.test.ts` — follow its structure for new tests.

## UI Tests (`ui/tests/`)

- **Environment**: jsdom (not browser).
- **Fetch mocking**: `fetch` is mocked by default in the test setup.
  - Use `mockFetchJsonOnce(data)` to simulate API responses.
- **Scope**: pure utility and logic tests only.
  - No component rendering tests (yet).
  - Test store logic, formatters, parsers, validators.
- **Reference file**: `ui/tests/utils/markdown.test.ts`.

## E2E Tests (`e2e/tests/`)

- **File naming**: numbered prefix by feature group (00-08).
  - `00-*` setup, `01-*` landing, `02-*` auth, etc.
- **Authentication**:
  - Default: `.auth/state.json` provides admin session (pre-authenticated).
  - Unauthenticated tests: `test.use({ storageState: undefined })`.
- **Page readiness**: always `await page.waitForLoadState('domcontentloaded')` before asserting.
  - Do not rely on `networkidle` — SSE connections keep the network busy.
- **Selectors** (preference order):
  1. `getByRole()` — accessible role + name.
  2. `getByText()` — visible text content.
  3. CSS selectors — last resort only.
- **Email verification**:
  - `waitForVerificationCode()` — polls Maildev for OTP.
  - `waitForMagicLinkToken()` — polls Maildev for magic link.
- **API fixtures**: `createOrganization()`, `createFolder()`, `createUseCase()` from `e2e/helpers/api-fixtures.ts`.
  - Use fixtures for test data setup instead of UI interactions.
- **Reference file**: `e2e/tests/02-auth-simple.spec.ts`.

## Make Targets

- **Scoped API test**:
  ```
  make test-api-endpoints SCOPE=<file> ENV=test-<branch>
  ```
- **Scoped UI test**:
  ```
  make test-ui SCOPE=<file>
  ```
- **Scoped E2E test**:
  ```
  make test-e2e E2E_SPEC=<file> WORKERS=1 RETRIES=0 ENV=e2e-<branch>
  ```
- **AI integration tests**:
  ```
  make test-api-ai ENV=test-<branch>
  ```
- Always use make targets — never invoke vitest or playwright directly.
- NEVER run tests with `ENV=dev` — destructive `afterEach` hooks purge real data.
