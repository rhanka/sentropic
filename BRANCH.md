# Feature: BR-42h-L3 follow-up — harness 0.2.1 (test-verb category validation, TDD)

## Objective
Quick completion branch on top of `@sentropic/harness@0.2.0`: add the missing `harness test --category`
validation (honest gap — 0.2.0 accepted any category string), done **red-first (TDD)**, plus completeness
tests for the `test`/`debug`/`plan` `--json` WorkEvent shapes. Bump 0.2.1, publish. (Also removes a stale
`BRANCH.md` left on `main` by an earlier lane — deleted at merge per convention.)

## Scope / Guardrails
- Scope limited to `packages/harness/**` (pure tooling lib). `runHarnessCli` stays pure.
- Make-only harness lane (`make typecheck-harness`, `make test-harness ENV=test-*`). No services, no ports.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/harness/src/cli/method-verbs.ts`
  - `packages/harness/tests/cli/method-verbs.spec.ts`
  - `packages/harness/package.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `.github/workflows/**`
  - any `api/**`, `ui/**`, `e2e/**`, other `packages/**`, other `plan/NN-BRANCH_*.md`
- **Conditional Paths**: none.
- **Exception process**: declare `BR42h-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- none open.

## AI Flaky tests
- N/A — pure deterministic unit tests.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** — single-file change + tests, one gate.
- [ ] Multi-branch
- Rationale: tiny TDD follow-up on one package.

## Plan / Todo (lot-based)
- [x] **Lot 1 — TDD: `harness test --category` validation**
  - [x] RED: failing test `test --category bogus` → exit 2 (confirmed: 1 failed / 66 passed).
  - [x] GREEN: validate `--category` against `unit|integration|e2e` in `method-verbs.ts` (invalid → usage exit 2).
  - [x] Completeness tests: valid categories, no-category, `test --json`, `debug`/`plan` `--json` WorkEvent shape.
  - [x] Gate: typecheck clean + test-harness **67/67** green (ENV=test-harness-021).
- [ ] **Lot N — Final**
  - [x] Bump `packages/harness/package.json` 0.2.0 → 0.2.1 (patch).
  - [ ] PR with this `BRANCH.md` as body → CI green → remove `BRANCH.md` → merge → OIDC publishes 0.2.1.
  - [ ] Install `@sentropic/harness@0.2.1` system-wide (`npm i -g`).
