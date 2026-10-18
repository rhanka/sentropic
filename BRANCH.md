# Feature: Publish reusable MCP packages

## Objective
- [ ] Make the reusable MCP libraries, connector host, UBO contracts and skills publishable through CI, with an owner-operated disposable web-login bootstrap.

## Scope / Guardrails
- [x] Worktree: `tmp/worktrees/publish-mcp-packages`; branch: `feat/publish-mcp-packages`; baseline: `origin/main`.
- [x] Make-only execution; Docker-only Node tooling; `ENV` last; one build at a time.
- [x] Environment: `test-publish-mcp-packages`; no services or ports required; never use `ENV=dev`.
- [x] Never merge, publish or execute the bootstrap; never access secrets.
- [x] Atomic Conventional Commits, at most 150 changed lines, through `make commit`.
- [x] Keep auth-idp and llm-gateway-host private: deployable applications, not reusable libraries.
- [x] Artifacts publication belongs to PR #688; preserve that package here.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/mcp-connector-*/**`
  - `packages/mcp-broker/**`
  - `packages/connector-host/**`
  - `packages/ubo-contracts/**`
  - `packages/skills/package.json`
  - `packages/skills/CHANGELOG.md`
  - `scripts/ci/**`
  - `scripts/publish/**`
  - `package-lock.json`
  - `.h2a/build/publish_mcp_packages_report.md`
  - `Makefile`
  - `.github/workflows/ci.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `api/**`
  - `ui/**`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `rules/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare rationale, impact and rollback before edits in Feedback Loop.

## Feedback Loop
- [x] BR-EX1 — acknowledged by launch packet: edit `Makefile` for guarded pack/publish, build/test and disposable web-login targets; impact limited to package tooling; rollback: revert added targets and restored recipes.
- [x] BR-EX2 — acknowledged by launch packet: edit `.github/workflows/ci.yml` for paths, validation, OIDC publishers, bootstrap choices and gate dependencies; rollback: revert the added package lanes.
- [x] BR-EX3 — owner packet supersedes prior UBO publication deferral: publish `@sentropic/ubo-contracts` under its existing name; no contract changes.
- [x] BR-EX4 — existing 0.1.0 Gmail needs a patch bump if source imports change; first versions otherwise 0.1.0, skills remains 0.1.2.

## AI Flaky tests
- [x] None: this branch uses deterministic package and script checks.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: sequential implementation and builds; no cherry-picks or delegated implementation.
- [ ] **Multi-branch**
- [x] Rationale: one publication capability; constrained disk; no application services.

## UAT Management (in orchestration context)
- [x] Package UAT uses disposable consumers in the branch environment; web app, Chrome and VSCode UI are unaffected.
- [x] Owner-only live bootstrap is documented and stays unexecuted on this branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read repository rules, template and package publication tooling; verify branch mechanically.
  - [x] Run `make ps-all ENV=test-publish-mcp-packages`; no Compose services.
  - [x] Declare scope, exceptions, isolated environment and commit discipline.
- [ ] **Lot 1 — Public package manifests and portable source imports**
  - [x] Configure files, exports, provenance, license, repository and semver dependencies for all 18 libraries.
  - [x] Replace connector/broker sibling-source imports with public MCP platform entry points; preserve behavior and experimental boundaries.
  - [x] Add/update README and CHANGELOG per package; retain proof/live limitations.
  - [x] Prepare manifests and release documentation: ubo-contracts, mcp-broker, connector-host.
  - [x] Prepare manifests and release documentation: mcp-connector-airtable, mcp-connector-dropbox, mcp-connector-github.
  - [x] Prepare manifests and release documentation: mcp-connector-gmail, mcp-connector-google, mcp-connector-googlecalendar.
  - [x] Prepare manifests and release documentation: mcp-connector-googledocs, mcp-connector-googledrive, mcp-connector-googlesheets.
  - [x] Prepare manifests and release documentation: mcp-connector-hubspot, mcp-connector-linear, mcp-connector-notion.
  - [x] Prepare manifests and release documentation: mcp-connector-slack, mcp-connector-stripe, skills.
  - [x] Port sibling-source imports, batch 1: 9 files.
  - [x] Port sibling-source imports, batch 2: 9 files.
  - [x] Port sibling-source imports, batch 3: 9 files.
  - [x] Port sibling-source imports, batch 4: 9 files.
  - [x] Port sibling-source imports, batch 5: 1 files.
  - [x] Refresh affected workspace lock entries through Docker/Make.
  - [x] Run guard/wiring tests; adapt missing-lane regression fixture now that skills has a lane.
  - [ ] Lot gate: `make test-publishable-manifests ENV=test-publish-mcp-packages`.
- [ ] **Lot 2 — Guarded build, pack and web-login bootstrap**
  - [x] Add standalone Docker build/test/lock tooling without host dependencies.
  - [x] Add guarded pack/OIDC publish targets for the first nine libraries.
  - [x] Add build/pack/publish lanes using existing exact-artifact guard and OIDC.
  - [x] Add `make npm-bootstrap-web PKGS="..." ENV=test-publish-mcp-packages` over already verified archives.
  - [x] Check hashes, manifests, dependency order and missing archives before web login; never mount host npm credentials.
  - [x] Use throwaway node:24 container/session; provenance only in supported CI context; cleanup on failure/interruption.
  - [ ] Document owner approval, Trusted Publisher setup and later CI releases in `scripts/publish/README.md`.
  - [ ] Script tests: new `scripts/publish/npm-bootstrap-web.test.mjs`; existing manifest guard tests unchanged unless wiring requires updates.
- [ ] **Lot 3 — CI publication train**
  - [x] Add publication/validation filters, batch 1 (9 packages).
  - [x] Add publication/validation filters, batch 2 (9 packages).
  - [x] Wire validation, consumer smoke, OIDC publisher and gate: ubo-contracts, mcp-broker.
  - [x] Wire validation, consumer smoke, OIDC publisher and gate: connector-host, mcp-connector-airtable.
  - [x] Wire validation, consumer smoke, OIDC publisher and gate: mcp-connector-dropbox, mcp-connector-github.
  - [x] Wire validation, consumer smoke, OIDC publisher and gate: mcp-connector-gmail, mcp-connector-google.
  - [x] Wire validation, consumer smoke, OIDC publisher and gate: mcp-connector-googlecalendar, mcp-connector-googledocs.
  - [x] Wire validation, consumer smoke, OIDC publisher and gate: mcp-connector-googledrive, mcp-connector-googlesheets.
  - [x] Wire validation, consumer smoke, OIDC publisher and gate: mcp-connector-hubspot, mcp-connector-linear.
  - [x] Wire validation, consumer smoke, OIDC publisher and gate: mcp-connector-notion, mcp-connector-slack.
  - [x] Wire validation, consumer smoke, OIDC publisher and gate: mcp-connector-stripe, skills.
  - [x] Add all 18 filters, validate/publish jobs, dispatch choices and ci-gate needs; package-only publication triggers.
  - [x] Register mappings in `scripts/ci/publishable-manifests.mjs`; update `scripts/ci/publishable-ci-wiring.test.mjs`.
  - [x] Newly public packages have web bootstrap only, never token bootstrap steps.
  - [ ] Lot gate: `make test-publishable-manifests ENV=test-publish-mcp-packages`.
- [ ] **Lot 4 — Packaged consumer qualification**
  - [x] New `scripts/publish/packaged-consumer.test.mjs`: install real guarded archives and import every public Node entry point, including experimental/hono entries.
  - [x] Give each guarded archive a dedicated empty destination (guard rejects shared output directories).
  - [ ] Gate: `make test-publishable-consumers ENV=test-publish-mcp-packages`.
  - [ ] API tests: none; no API implementation changes.
  - [ ] UI tests: none; no UI implementation changes.
  - [ ] E2E tests: none; package consumer smoke replaces irrelevant application campaigns.
  - [ ] UAT: inspect packed files, verify all 18 imports, inspect topological bootstrap list; leave security-key login to owner.
- [ ] **Lot 5 — Documentation and final validation**
  - [ ] Review final diff and scope; run guard/wiring/bootstrap/consumer tests and package typecheck gates.
  - [ ] Write `.h2a/build/publish_mcp_packages_report.md` with exact versions, first-publication order, commands and results.
  - [ ] Push branch and create draft PR using this file as body; post 3–6 step plan comment.
  - [ ] Watch CI and resolve branch failures; record external blockers with evidence.
  - [ ] Keep BRANCH.md for draft handoff; never merge or publish.
