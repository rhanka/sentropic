---
name: debug-probe
description: Create and run a Playwright scratch probe to reproduce and fix a UI bug
paths: "e2e/tests/dev/**,ui/src/lib/components/**,ui/src/routes/**"
allowed-tools: Read Write Bash Edit Glob Grep
---

## Debug Probe Workflow

Dev lane status: !`make ps-dev-playwright 2>/dev/null || echo "NOT RUNNING"`

### Bootstrap (if not running)
1. `make up-dev-playwright ENV=dev`
2. `make record-dev-playwright-auth ENV=dev`

### Create scratch probe
Create `e2e/tests/dev/_scratch.<bug-slug>.spec.ts`:
- Import `test, expect` from `@playwright/test`
- Use `.auth/dev-state.json` storage state
- Target: reproduce the EXACT bug signal (not broad validation)
- Prefer exact waits: `waitForResponse`, `locator.waitFor`, `expect.poll`
- NEVER use `sleep()` unless no other signal available

### Run
`make exec-playwright-dev CMD="npx playwright test tests/dev/_scratch.<bug-slug>.spec.ts --headed" ENV=dev`

### Methodology
1. Reproduce → capture signal (screenshot, network, console)
2. Observe → identify root cause (wrong selector, race, regression)
3. Fix → apply focused change in source
4. Re-run probe → verify fix
5. If stable → extract into permanent test in `e2e/tests/0X-*.spec.ts`
6. Clean up → delete scratch probe (never commit `_scratch.*` files)

> Probe ≠ product test. Bug fix commit ≠ probe commit. Separate concerns.
