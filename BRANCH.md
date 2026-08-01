# Feature: mcp-connector-google flat resolvable dist

## Objective
Make `@sentropic/mcp-connector-google` emit a real flat `dist/index.js` from its own `tsc` build, so any consumer (api Docker bundle, Makefile, publish) resolves it identically — removing the Makefile-only symlink workaround. Unblocks the api image build once a route consumes the connector-host mount.

## Scope / Guardrails
- Scope limited to `packages/mcp-connector-google/**` and one `Makefile` target (`build-mcp-connector-google`).
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/fix-mcp-connector-google-flat`.
- Automated tests run on dedicated env (`ENV=test-mcpcg`), never on root `dev`.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/mcp-connector-google/src/**`
  - `packages/mcp-connector-google/tests/**`
  - `Makefile` (target `build-mcp-connector-google` only — see BR-MCPCG-EX1)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - any other `packages/**`, `api/**`, `ui/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` — covered by BR-MCPCG-EX1

## Feedback Loop
- `BR-MCPCG-EX1` (Makefile): the `build-mcp-connector-google` target carried a post-`tsc` `ln -sfn mcp-connector-google/src/index.js dist/index.js` hack compensating for a nested `tsc` emit. Root cause: `src` imported mcp-platform via deep relative paths (`../../mcp-platform/src/*.js`), so `tsc` pulled mcp-platform source into the program and nested the emit under `dist/mcp-connector-google/src/`. Fix: import mcp-platform through its package specifier (`@sentropic/mcp-platform`, its public `.` contract) so `tsc` resolves to the built `.d.ts` and emits a flat `dist/index.js`; the now-wrong symlink is removed. Impact: build target only, no runtime change. Rollback: restore the two `ln -sfn` steps and revert the import changes. Status: acknowledge.

## Lot 1 — flat resolvable dist
- [x] `src/{manifest,live-adapter,adapter,live-broker}.ts`: mcp-platform deep-relative type imports -> `@sentropic/mcp-platform` (public `.` contract)
- [x] `tests/{google,google-live}.test.ts`: same import normalization
- [x] `Makefile`: remove the `ln -sfn ...dist/index.{js,d.ts}` symlink hack from `build-mcp-connector-google` (BR-MCPCG-EX1)
- [x] `make build-mcp-connector-google` emits a real flat `dist/index.js` (no nesting, no symlink) — verified
- [x] `make test-mcp-connector-google ENV=test-mcpcg` green (2 files / 32 tests) — verified
- [ ] CI green on PR (typecheck-lint-api, build-api-image, unit shards)
