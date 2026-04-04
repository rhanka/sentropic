---
name: new-e2e
description: Scaffold a new E2E Playwright test following project patterns
paths: "e2e/tests/**"
allowed-tools: Read Write Bash Edit Glob Grep
---

## New E2E Test Scaffold

Reference: `e2e/tests/02-auth-simple.spec.ts`

1. Use numbered prefix matching feature group (00-08)
2. Default auth: `.auth/state.json` (admin). Unauthenticated: `test.use({ storageState: undefined })`
3. Always: `await page.waitForLoadState('domcontentloaded')` before asserting
4. Selectors: `getByRole()` > `getByText()` > CSS selectors
5. API fixtures from `e2e/helpers/api-fixtures.ts` (`createOrganization`, `createFolder`, `createUseCase`)
6. Email testing: `waitForVerificationCode()` / `waitForMagicLinkToken()` from `e2e/helpers/maildev.ts`
7. Run: `make test-e2e E2E_SPEC=tests/<file>.spec.ts WORKERS=1 RETRIES=0 ENV=e2e-$BRANCH`
