# Feature: Artifacts 0.2.0 UTF-8 publication and host packaging

## Objective
- [x] Expose installed adapters and SQL resources, and add UTF-8 text publication through HTTP and MCP.

## Scope / Guardrails
- [x] Worktree: `tmp/worktrees/artifacts-012`; branch: `fix/artifacts-0.1.2-adapters-migrations`; base: `origin/main`.
- [x] Make-only, Docker-first; `ENV=test-artifacts-012` last; no merge, publication, or `make clean-all`.
- [x] No application services required; reserved ports API=9060, UI=5260, MAILDEV_UI=1160 remain unused.
- [x] Reference read only: Immo `SPEC_861C_ARTIFACT_HOST.md` section 2.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/package.json`
  - `packages/artifacts/README.md`
  - `packages/artifacts/probe/**`
  - `packages/artifacts/src/http.ts`
  - `packages/artifacts/src/mcp.ts`
  - `packages/artifacts/src/content/headers.ts`
  - `packages/artifacts/tests/http-mcp-service-parity.test.ts`
  - `packages/artifacts/tests/mcp.test.ts`
  - `packages/artifacts/tests/content-security.test.ts`
  - `package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/artifacts/migrations/**`
  - `plan/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare rationale, impact, and rollback in Feedback Loop before touching a forbidden path.

## Feedback Loop
- [x] BR012-EX1: allow only the existing packed-consumer Makefile recipe to install optional driver peers after proving core-only imports; impact limited to the disposable Docker consumer; rollback restores that recipe and probes together.
- [x] BR012-EX2: allow one packed-consumer step in `.github/workflows/ci.yml` so adapter/SQL regressions block artifacts CI; impact limited to package validation; rollback removes the added step.
- [x] BR012-EX3: owner requests text publication and permits CORP/bootstrap changes; allow only the listed source/test files; impact is additive transport input plus same-origin resource policy; rollback reverts these changes and their tests.
- [x] Design: exactly one of bytes/text per file; canonical lowercase text/*, JavaScript, JSON, XML and structured JSON/XML MIME types; reject MIME parameters; encode UTF-8 before existing digest/size verification.
- [x] Version decision: 0.2.0 because text is an additive API feature (minor under rules/workflow.md); registry baseline is 0.1.1; satisfies enforce-package-bump.
- [x] Track import belongs to the designated repository writer; this concurrent worktree updates only the mergeable branch plan.
- [ ] Independent peer review awaits the launch authorization required by `rules/subagents.md`; no reviewers launched or consensus claimed.

## AI Flaky tests
- [x] No AI-dependent tests or timeout changes.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: implementation and final verification in this worktree.

## UAT Management (in orchestration context)
- [x] Package-only consumer qualification; no web, Chrome, or VS Code surface changes.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read rules, branch template, package, adapters, migrations, packed probe, and host reference.
  - [x] Verify branch with Git and `harness check branch` before work.
  - [x] Confirm source manifest omits adapter exports and migration files.
  - [x] Docker/Make registry check returned 0.1.1 before choosing the 0.2.0 minor bump.
- [x] **Lot 1 — Publishable package contract**
  - [x] Add typed adapter exports and SQL resource export; include migrations; release candidate is 0.2.0.
  - [x] Declare injected driver packages as optional peers and synchronize workspace lock metadata.
  - [x] Document driver installation and ordered host-managed SQL execution in README; no package changelog exists.
- [x] **Lot 2 — Packed-consumer regression**
  - [x] Extend `packages/artifacts/probe/packed-consumer.mjs` to verify core without drivers and shipped SQL.
  - [x] Add adapter imports/types resolution checks after explicit driver installation in the existing Make recipe.
  - [x] Run the packed-consumer regression in the existing artifacts CI validation job; 22 CI-wiring fixture tests pass.
  - [x] Reproduce 0.1.1 `ERR_PACKAGE_PATH_NOT_EXPORTED`, then pass `make probe-artifacts-packed-consumer ENV=test-artifacts-012` on 0.2.0 (15 tools, two adapters, two SQL resources).
- [x] **Lot 3 — Final validation and handoff**
  - [x] Run `make typecheck-artifacts lint-artifacts test-artifacts ENV=test-artifacts-012`: typecheck, lint, 158 tests in 24 files pass.
  - [x] Inspect the real 0.2.0 tarball: 67 packaged files; packed-manifest guard passes.
  - [x] Review final diff, run `make scope-check` before each atomic commit under 150 changed lines.
  - [x] Open PR #703 using this plan; the final delivery lot refreshes its title/body and checks the pushed HEAD.
  - [x] Leave merge and npm publication for the owner's GO.
- [x] **Lot 4 — UTF-8 publication**
  - [x] Add mutually exclusive bytes/text inputs to HTTP and the MCP schema; keep binary bytes behavior.
  - [x] Extend `tests/http-mcp-service-parity.test.ts` and `tests/mcp.test.ts` for accented UTF-8, empty text, MIME restrictions, exclusivity and byte-identical manifests.
- [x] **Lot 5 — Content isolation and host setup**
  - [x] Add CORP same-origin with HTML/CSS/binary coverage in `tests/content-security.test.ts`.
  - [x] Document text input, accepted MIME types and host-owned storage_scopes bootstrap in README.
- [x] **Lot 6 — Packed candidate and delivery**
  - [x] Bump package/lock metadata to 0.2.0 and prove text publication in `probe/packed-consumer.mjs` without source imports.
  - [x] Packed proof: `version=0.2.0 utf8Bytes=32 textValidation=ok corp=same-origin fetchCalls=0`; `PACKED_ADAPTERS_OK adapters=2 migrations=2`.
  - [x] Run typecheck, lint, all 158 package unit tests and packed consumer; inspect branch diff and scope before atomic commits.
  - [x] Update PR #703 title/body with version rationale and validation, push, and inspect CI; no merge or publication.
