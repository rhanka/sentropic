# Feature: Publish the qualified MCP broker

## Objective
- [ ] Prepare the exact P3 archive for owner bootstrap of `@sentropic/mcp-broker@0.1.0` and OIDC CI publication for later versions.

## Scope / Guardrails
- [x] Branch `feat/mcp-broker-publish` starts at `origin/main`; worktree `tmp/feat-mcp-broker-publish`.
- [x] Make-only, Docker-first; `ENV=test-mcp-broker-publish` last; no service ports used.
- [x] Preserve all source, compiler, P3 manifest, catalog and freeze bytes; retain version 0.1.0.
- [x] Verify exact P3 broker archive SHA-256 5fede653683acc8d803f7e735526f09a1d79b062ae4a37b0b9933bfd289444fa; packed manifest has no private flag.
- [x] Owner dossier and registry evidence live outside the tracked branch in `.tmp/npm-bootstrap/`.
- [x] No merge or publication requested in this author lane; create a draft PR to main.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/mcp-broker/package.json`
  - `packages/mcp-broker/README.md`
  - `packages/mcp-broker/LICENSE`
  - `scripts/ci/publishable-manifests.mjs`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `scripts/ci/publishable-classification.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/*/src/**`
  - `tools/memory-mcp-l5/**`
  - `spec/evidence/memory-mcp-l5/**`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/ci.yml`
- **Exception process**:
  - [x] BRMP-EX1: owner explicitly requested Make targets and CI wiring; additive broker pack/OIDC/bootstrap paths only; rollback by reverting these additions.

## Feedback Loop
- [x] BRMP-EX1 acknowledged by the explicit task; no source or frozen evidence edits authorized.
- [ ] Document new-name bootstrap requirements from current npm documentation, including local bootstrap provenance limitation.

## AI Flaky tests
- [x] No AI tests changed or accepted as flaky.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; independent review through the owner-mandated Muse wrapper.

## UAT Management (in orchestration context)
- [x] No web, Chrome or VSCode behavior changes; packed Node consumer checks provide publication UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read rules, reference publisher, package manifests, P3 manifest and branch template.
  - [x] Create isolated branch and run `harness check branch` (PASS C1).
- [x] **Lot 1 — Package metadata**
  - [x] Remove private, include MIT LICENSE, distinguish the memory-only P3 bootstrap from subsequent full packages.
- [ ] **Lot 2 — Make and CI publication**
  - [ ] Mirror platform guarded pack, OIDC publisher, filters and job; require memory qualification; no repacked token bootstrap.
- [ ] **Lot 3 — Regression tests**
  - [ ] Update guard publisher/pack inventories and classification fixtures; leave bootstrap targets unchanged.
  - [ ] Extend `scripts/ci/publishable-ci-wiring.test.mjs` for broker release contract and main-only publication.
- [ ] **Lot 4 — Artifacts and owner handoff**
  - [ ] Run `make test-publishable-manifests` and `make test-mcp-broker` in the isolated environment.
  - [ ] Pack exact candidate, compare every broker dist member against the P3 archive, and verify clean installed root/memory imports.
  - [ ] Query npm directly with curl for engram 0.22.0 and cluster-mesh builtin dependencies; record missing names/versions.
  - [ ] Write short French owner steps with exact tarball path, SHA-256 and trusted-publisher fields.
- [ ] **Lot 5 — Final validation**
  - [ ] Obtain independent review and reconcile findings.
  - [ ] Run scope check before each atomic commit; no source bump required because no src changes.
  - [ ] Draft PR body from this file, add the execution plan, and verify completed/success CI on exact head.
