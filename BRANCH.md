# Feature: Artifacts 0.1.2 UTF-8 publication and host packaging

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
  - `packages/cluster-mesh/tests/integrations/artifacts-surface.spec.ts`
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
- [x] Version decision (owner-authorized option a): use 0.1.2 for the backward-compatible, additive change; registry baseline is 0.1.1. This is the fastest unblock because cluster-mesh already accepts >=0.1.0 <0.2.0, avoiding a cluster-mesh release. This explicit choice supersedes the default minor-bump guidance and the initial 0.2.0 candidate below.
- [x] BR012-EX4: allow only the cluster-mesh artifacts integration test to expect provider 0.1.2; no cluster-mesh production changes or version bump; rollback restores the assertion alongside the provider version.
- [x] Track import belongs to the designated repository writer; this concurrent worktree updates only the mergeable branch plan.
- [x] Received Astra round 1 at `.h2a/reviews/pr703_astra_r1.md`: packaging/text pass; blocking R1 requires consumer-compatible versioning and exact-head CI. No additional reviewers launched or consensus claimed.

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
  - [x] Docker/Make registry check returned 0.1.1 before choosing the owner-authorized 0.1.2 patch.
- [x] **Lot 1 — Publishable package contract**
  - [x] Add typed adapter exports and SQL resource export; include migrations; release candidate is 0.1.2.
  - [x] Declare injected driver packages as optional peers and synchronize workspace lock metadata.
  - [x] Document driver installation and ordered host-managed SQL execution in README; no package changelog exists.
- [x] **Lot 2 — Packed-consumer regression**
  - [x] Extend `packages/artifacts/probe/packed-consumer.mjs` to verify core without drivers and shipped SQL.
  - [x] Add adapter imports/types resolution checks after explicit driver installation in the existing Make recipe.
  - [x] Run the packed-consumer regression in the existing artifacts CI validation job; 22 CI-wiring fixture tests pass.
  - [x] Reproduce 0.1.1 `ERR_PACKAGE_PATH_NOT_EXPORTED`, then pass `make probe-artifacts-packed-consumer ENV=test-artifacts-012` on 0.1.2 (15 tools, two adapters, two SQL resources).
- [x] **Lot 3 — Final validation and handoff**
  - [x] Run `make typecheck-artifacts lint-artifacts test-artifacts ENV=test-artifacts-012`: typecheck, lint, 158 tests in 24 files pass.
  - [x] Inspect the real 0.1.2 tarball: 67 packaged files; packed-manifest guard passes.
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
  - [x] Bump package/lock metadata to 0.1.2 and prove text publication in `probe/packed-consumer.mjs` without source imports.
  - [x] Packed proof: `version=0.1.2 utf8Bytes=32 textValidation=ok corp=same-origin fetchCalls=0`; `PACKED_ADAPTERS_OK adapters=2 migrations=2`.
  - [x] Run typecheck, lint, all 158 package unit tests and packed consumer; inspect branch diff and scope before atomic commits.
  - [x] Update PR #703 title/body with version rationale and validation, push, and inspect CI; no merge or publication.
- [ ] **Lot 7 — Astra R1 compatibility correction**
  - [x] Verify branch mechanically and confirm registry baseline 0.1.1 before selecting 0.1.2.
  - [x] Reproduce both failures on 0.2.0 with `make test-cluster-mesh SCOPE=tests/integrations/artifacts-surface.spec.ts ENV=test-artifacts-012`; the same 7 tests pass on 0.1.2.
  - [x] Align artifacts package, provider, workspace lock metadata, README and both version assertions to 0.1.2.
  - [x] Pass the scoped cluster-mesh suite (7 tests), artifacts unit suite (158 tests) and packed-consumer proof (15 tools, 2 adapters, 2 migrations); packed archive SHA-256: ec145fbb68fe50b45bd7e0f88976674b3c86472c9436ef3361334cfd35b53562.
  - [x] Review the minimal diff and pass the mechanical scope gate; commit via Make.
  - [ ] Update PR #703 with the version decision, push, and require green CI at the exact resulting HEAD; do not merge or publish.
