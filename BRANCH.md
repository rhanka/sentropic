# Feature: VD-2.1 shared V8 compile contract

## Objective
- [ ] Deliver AMD-ISO and the versioned recipe, output and diagnostic schemas with shared conformance vectors.

## Scope / Guardrails
- [x] Worktree tmp/worktrees/v8-contract; branch feat/v8-vd-2-1-contract from origin/main e44e2e2bf.
- [x] Preserve execution-node.v1 and historical DsRecipeKeyV1 byte semantics.
- [x] ENV=feat-v8-contract; tests ENV=test-v8-contract; API_PORT=9010 UI_PORT=5210 MAILDEV_UI_PORT=1110, checked free.
- [x] Make-only, Docker-first, ENV last; no Python, secrets, timeout increases or merge.
- [x] Re-read the live VD-2.1 specification row before each atomic commit below 150 lines.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `apps/sandbox-node/src/contract.ts`
  - `packages/cluster-mesh/src/compile/contract/**`
  - `packages/cluster-mesh/tests/compile/**`
  - `packages/cluster-mesh/package.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `BRANCH.md`
  - `.github/workflows/**`
- **Exception process**:
  - [x] BR21-EX1: BRANCH.md is required execution metadata; impact limited to this branch plan; rollback by removing it before integration.

## Feedback Loop
- [ ] Conductor owns Track writes and DS/h2a consumer receipts; questions recorded in .tmp/rv/v8-contract-questions.md.

## AI Flaky tests
- [x] No AI-dependent tests or flaky exceptions.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: D6-A reserves this contract slot separately from the VD-2.0 spike; no integration or merge in this lane.

## UAT Management (in orchestration context)
- [x] Library contract only; no web, Chrome or VSCode product surface changes.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, source contracts, normative recipe, options and gate requirements; check branch mechanically.
- [x] Lot 1: add shared closed types and AMD-ISO canonical declaration without changing historical definitions.
  - [x] Define portable compile recipe, options, output and diagnostic types; npm view reports 0.25.0, local version bumped to 0.26.0-dev.27.
  - [x] Define host-authenticated execution context and validate success/refusal diagnostics without partial output leaks.
- [ ] Lot 2: implement portable canonical encoding, path/base64 checks, recipe and output validation with closed effective options.
  - [x] Add portable closed JSON schemas for recipe, effective options, manifest, descriptors and diagnostics.
  - [x] Add RFC 8785 encoding, SHA-256/SRI, canonical base64/path checks and duplicate-key JSON parsing.
  - [x] Implement semantic recipe and manifest validation, exact output verification and distinct recipe/manifest identities.
- [ ] Lot 3: packages/cluster-mesh/tests/compile/contract.spec.ts covers shared golden vectors, changes of identity, invalid paths/options, diagnostic codes, manifest/SRI identity and legacy preservation.
  - [x] Publish reusable JCS/SHA-256/path/base64/JSON conformance corpus and canonical-profile checks.
- [ ] Lot 4: run scoped make test-cluster-mesh, typecheck-cluster-mesh and independent code review; resolve findings.
- [ ] Lot 5: bump/export cluster-mesh after registry check; make scope-check before every commit.
- [ ] Lot 6: push, open PR with this plan, wait for exact-head green CI; do not merge.
- [ ] Lot 7: make down-volumes for test environment; write report with file:line evidence, PR and CI; then completion marker.
