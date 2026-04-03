---
description: "Playwright live debugging, dev lane bootstrap, debug probe methodology"
alwaysApply: false
paths: ["e2e/tests/dev/**"]
globs: ["e2e/tests/dev/**"]
tags: [debug, playwright, live]
---

# LIVE DEBUG

## Goal
Use Playwright as a fast **observe -> act -> re-observe** debug tool without turning every investigation into a permanent E2E test.

**For**: UI bugs needing real browser behavior (hover, scroll, streaming, reload, focus, popover, timing), issues hard to diagnose from logs alone, short live-debug loops on real app state.

**Not for**: destructive test campaigns on `ENV=dev`, broad product validation, replacing permanent regression tests.

## Environment Policy

### `ENV=dev` -- Allowed
- Manual navigation, read-mostly debug, scoped Playwright probes that do NOT seed/reset data

### `ENV=dev` -- Forbidden
- `make test-e2e`, seed/reset/global setup flows, anything that rewrites Demo data without explicit need

## Dev Lane Bootstrap (MANDATORY before auth-bound probes)
1. Start helper lane: `make up-dev-playwright ... ENV=dev`
2. Record/refresh storage state: `make record-dev-playwright-auth ... ENV=dev`
3. Run probes: `make exec-playwright-dev ... ENV=dev` or `make test-e2e-dev ... ENV=dev`

- Prefer `make exec-playwright-dev` over generic `make exec-%` (bootstraps dedicated helper lane with correct `UI_BASE_URL`, `API_BASE_URL`, `MAILDEV_API_URL`)
- To override endpoints: use `PLAYWRIGHT_UI_BASE_URL`, `PLAYWRIGHT_API_BASE_URL`, `PLAYWRIGHT_MAILDEV_API_URL`
- Do NOT rely on repo-level `UI_BASE_URL`/`API_BASE_URL`/`MAILDEV_API_URL` for this lane
- If ports changed or lane stale: `make down-dev-playwright ... ENV=dev` then re-bootstrap

## Debug Probe Methodology

### 1. Start from the smallest reproducible surface
- One page, one interaction, one expected signal
- Do NOT begin with a full end-to-end scenario

### 2. Use ad hoc debug probes, not permanent tests
- Create untracked scratch: `e2e/tests/dev/_scratch.<bug>.spec.ts`
- Rewrite freely each pass, delete once bug understood
- First version: navigate, reproduce, inspect target symptom only
- Acceptable temp code: network listeners, console dumps, screenshots, `page.evaluate(...)`, DOM dumps
- Do NOT commit throwaway debug instrumentation

### 3. Observe before acting again
Collect minimum useful signals per step:
- Current URL, visible target element state, relevant request/response, console errors, one screenshot if visual

### 4. Prefer exact signals over sleep
**Use**: `waitForResponse`, `waitForRequest`, `locator.waitFor`, `expect.poll`, `page.waitForLoadState`
**Avoid**: long `waitForTimeout`, broad retries without understanding the missing signal

### 5. Separate harness bugs from product bugs
Before blaming the product, verify:
- Auth state valid (`page.context().cookies()` has `session`, then `fetch('<api>/auth/session')` succeeds)
- Storage state correct: `e2e/.auth/dev-state.json`
- `workspaceScopeId` in localStorage if route requires workspace
- Correct base URL, no CORS/CSP issues
- Probe reaches the page and target element

Common false-negatives:
- Redirect to `/auth/login` -> stale/missing auth state
- `Failed to fetch` / CORS on `auth/session` -> wrong helper lane or origins
- Page "load error" before component mounts -> missing `workspaceScopeId`, not yet a product freeze

### 6. Promote only the useful part
- Keep smallest stable regression check
- Remove temporary logs/probes
- Move durable coverage into the right permanent test file

## Debug Loop Contract
1. Reproduce with a single dev probe
2. Capture one clear failure signal
3. Apply one focused code change
4. Re-run the same probe
5. If fixed, reduce probe to the stable assertion needed

**Never mix** harness refactor, product fix, and regression test promotion. Do them in order, in separate commits.

## Minimal Command Set (Make only)

```bash
make up-dev-playwright API_PORT=8787 UI_PORT=5173 MAILDEV_UI_PORT=1080 REGISTRY=local ENV=dev
make record-dev-playwright-auth API_PORT=8787 UI_PORT=5173 MAILDEV_UI_PORT=1080 REGISTRY=local ENV=dev
make exec-playwright-dev CMD='npx playwright test --config playwright.dev.config.ts tests/dev/_scratch.<bug>.spec.ts --workers=1 --retries=0 --reporter=list' API_PORT=8787 UI_PORT=5173 MAILDEV_UI_PORT=1080 REGISTRY=local ENV=dev
```

## Playwright Actions for Live Debug
- Navigation: `page.goto`, `page.reload`
- Interaction: `locator.click`, `locator.hover`, `page.mouse.move`, `page.keyboard.type`
- Observation: `locator.screenshot`, `page.on('request')`, `page.on('response')`, `page.on('console')`, `page.evaluate`
- Rich text / TipTap: do NOT use `.fill()` -- focus node, `Control+A`, `Backspace`, `keyboard.type`

## Commit Policy
- Commit harness feature separately from bug fix
- Do not commit temporary probe noise
- Promote stable regression to permanent E2E suite later

## Output Expectation
Report only: (1) current blocker, (2) exact failing signal, (3) harness or product, (4) next focused change.
