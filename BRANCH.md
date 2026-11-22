# Feature: Cloud Code enrollment from agy and probe in llm-mesh-enroll

## Objective
Add `llm-mesh-enroll enroll --provider cloud-code --from-agy [--account <id>] --keyring-dir <dir>` and `llm-mesh-enroll probe --provider cloud-code` to `@sentropic/llm-mesh`, with secret-safe tests, README operator procedure, CHANGELOG entry, and patch version bump (`0.38.7`).

## Scope / Guardrails
- Scope limited to `packages/llm-mesh/**` and `BRANCH.md`.
- Make-only workflow, no direct host npm/python commands.
- Branch development in isolated worktree `tmp/enroll-cloud-code` on `feat/llm-mesh-enroll-cloud-code`.
- Dedicated test env `ENV=test-enroll-cc`, ports `API_PORT=9210 UI_PORT=5410 MAILDEV_UI_PORT=1310`, `ENV` passed last.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/CHANGELOG.md`
  - `packages/llm-mesh/README.md`
  - `packages/llm-mesh/src/global.d.ts`
  - `packages/llm-mesh/src/node/cli/**`
  - `packages/llm-mesh/tests/node/**`
  - `packages/llm-mesh/tests/decision-public-surface.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`

## Feedback Loop
- None.

## AI Flaky tests
- None.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single focused package scope)
- [ ] **Multi-branch**
- Rationale: Single package `@sentropic/llm-mesh` CLI addition with self-contained tests and docs.

## UAT Management (in orchestration context)
- CLI-only change in `@sentropic/llm-mesh`; verified via unit tests, build, typecheck, lint, and live operator procedure.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, and `packages/llm-mesh/README.md`.
  - [x] Create isolated worktree `tmp/enroll-cloud-code` from `origin/main`.
  - [x] Verify npm registry version (`0.38.6`) and next free patch (`0.38.7`).
  - [x] Define test env `ENV=test-enroll-cc` and ports `API_PORT=9210 UI_PORT=5410 MAILDEV_UI_PORT=1310`.
  - [x] Declare scope boundaries in `BRANCH.md`.

- [x] **Lot 1 — Tests first (TDD)**
  - [x] Add `packages/llm-mesh/tests/node/enroll-cli-cloud-code.test.ts` covering args, new enroll, in-place re-enroll (`--account`), default `.key` and `--keyring-key-env`, probe (`gemini-4-hydrogen-low`), negative paths, and zero secret leaks.
  - [x] Confirm scoped red run via `make test-llm-mesh SCOPE=tests/node/enroll-cli-cloud-code.test.ts API_PORT=9210 UI_PORT=5410 MAILDEV_UI_PORT=1310 ENV=test-enroll-cc`.

- [x] **Lot 2 — Implementation (`--from-agy` reader, cloud-code enroll & probe)**
  - [x] Add `packages/llm-mesh/src/node/cli/agy-token-reader.ts` (file + pure-Node Linux Secret Service D-Bus fallback + strict parser, never logs secrets).
  - [x] Add `packages/llm-mesh/src/node/cli/enroll-cloud-code.ts` (refresh, loadCodeAssist resolve, in-place `--account` re-enroll preserving `.key` and `createdAt`/`ownerScopeRef`, new account creation).
  - [x] Wire `enroll-args.ts`, `enroll-command.ts`, and `enroll-cli.ts` (`--from-agy`, `--agy-token-file`, optional `--keyring-key-env` for `cloud-code`, and `probe --provider cloud-code`).
  - [x] Lot gate:
    - [x] `make test-llm-mesh SCOPE=tests/node/enroll-cli-cloud-code.test.ts API_PORT=9210 UI_PORT=5410 MAILDEV_UI_PORT=1310 ENV=test-enroll-cc`
    - [x] `make typecheck-llm-mesh API_PORT=9210 UI_PORT=5410 MAILDEV_UI_PORT=1310 ENV=test-enroll-cc`
    - [x] `make lint-llm-mesh API_PORT=9210 UI_PORT=5410 MAILDEV_UI_PORT=1310 ENV=test-enroll-cc`

- [ ] **Lot 3 — Docs, version bump, and final validation**
  - [x] Update `packages/llm-mesh/README.md` with the `cloud-code --from-agy` enroll and `probe --provider cloud-code` operator procedure.
  - [x] Bump `packages/llm-mesh/package.json` to `0.38.7` and add `0.38.7` entry in `packages/llm-mesh/CHANGELOG.md`.
  - [x] Run full gates: `make typecheck-llm-mesh`, `make lint-llm-mesh`, `make build-llm-mesh`, `make test-llm-mesh` with `API_PORT=9210 UI_PORT=5410 MAILDEV_UI_PORT=1310 ENV=test-enroll-cc`.
  - [x] Run `make scope-check API_PORT=9210 UI_PORT=5410 MAILDEV_UI_PORT=1310 ENV=test-enroll-cc`.
  - [ ] Push branch `feat/llm-mesh-enroll-cloud-code`, open PR, wait for CI green (do not merge).
