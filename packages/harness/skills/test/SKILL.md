---
name: test
description: Use when adding or evolving tests for a feature/bugfix — applies the sentropic test-pyramid, scoped-test loop, environment isolation, and AI-flaky policy.
---

# harness/test

Native sentropic testing discipline (NOT "tdd" ritual — the act is `test`). Open it with
`harness test [<scope>] [--category unit|integration|e2e] [--watch]` (records a WorkEvent), then follow
the loop.

## Pyramid

70% unit · 20% integration · 10% e2e. Test behaviour, not implementation — query by user-visible
elements (text/role/label) over test ids. Names: "should <behaviour> when <condition>".

## Scoped-test loop (while developing)

Run ONLY the test under evolution, on a dedicated test ENV — never `dev`:

- API: `make test-api-<suite> SCOPE=tests/<file>.spec.ts ENV=test-<slug>`
- UI: `make test-ui SCOPE=tests/<file>.spec.ts ENV=test-<slug>`
- E2E: `make test-e2e E2E_SPEC=tests/<file>.spec.ts API_PORT=… UI_PORT=… MAILDEV_UI_PORT=… ENV=e2e-<slug>`

Full gates only at end of lot/branch: `make test-api`, `make test-ui`, `make clean test-e2e`.

## Environment isolation (MANDATORY)

- NEVER run test campaigns on `ENV=dev` — afterEach hooks purge real data.
- Branch tests live in the isolated worktree on `ENV=test-<slug>` / `ENV=e2e-<slug>`; `ENV` is the LAST
  make argument.
- NEVER add timeouts to make a flaky e2e pass — a timeout failure is a real bug (bad selector, race,
  regression). UI waits are <2s except AI generation.

## AI-flaky allowlist (non-blocking)

Only accept non-systematic provider/network/model nondeterminism, and only with ≥1 success on the same
commit + command. Record the exact command + failing file + failure signature in `BRANCH.md` and get
explicit user sign-off before merge. Everything else is blocking.

## CI is authority

CI was green on main → any branch failure IS a branch problem; never claim "pre-existing". Decide:
evolution (adapt the test) or regression (fix the code). Local-green / CI-red → trust CI.
