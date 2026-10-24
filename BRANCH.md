# Feature: Artifacts 861 L7 mesh and tuple compatibility

## Objective
- [ ] Compose the selected artifacts 0.2.0 profile through mesh and qualify the package tuple.

## Scope / Guardrails
- [x] Implement spec r2 S3/L7 only; no artifacts entrypoint edits.
- [x] Worktree: `tmp/worktrees/861-L7`; branch: `feat/artifacts-861-L7`; base: `origin/feat/artifacts-861-L3`.
- [x] Merge L1 and L2 without rebase; preserve their implementation.
- [x] Make-only; Docker-only tooling; no Python; ENV=test-861-l7 always last.
- [x] No service stack needed; reserved API/UI/Maildev ports: 9035/5235/1135.
- [x] Draft PR targets `feat/artifacts-861-L3`; no main merge or publication.
- [x] Manifests and locks are integration-owner-only writes per spec r2 section 6.1.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/integrations/mcp/artifacts.ts`
  - `packages/cluster-mesh/src/loaders/mcp/artifacts.ts`
  - `packages/cluster-mesh/src/mcp/tool-configuration.ts`
  - `packages/cluster-mesh/src/storage/index.ts`
  - `packages/cluster-mesh/src/storage/common-contract.ts`
  - `packages/cluster-mesh/tests/integrations/artifacts-surface.spec.ts`
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts`
  - `packages/cluster-mesh/tests/packaging/tuple-strict.spec.ts`
  - `packages/cluster-mesh/tests/packaging/tuple-skew.spec.ts`
  - `packages/cluster-mesh/tests/packaging/mcp-registry-consumer.spec.ts`
  - `packages/cluster-mesh/tests/packaging/lock-integrity-registry.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/package-lock.json`
  - `packages/cluster-mesh/src/modules/semver.ts`
  - `packages/artifacts/**`
- **Exception process**:
  - [x] Record rationale, impact and rollback before changing conditional paths.

## Feedback Loop
- [x] BR861-EX2: inherit artifacts changes only through the explicitly requested L1/L2 merges; no authored artifacts edits. Impact: dependency ancestry; rollback: revert the merge. Merge commits retain inherited changes over 150 lines; authored commits remain under 150 lines.
- [x] BR861-EX3: the existing release-range parser rejects the spec-required `0.19.2 || >=0.22.0 <0.28.0`; extend only alternative parsing, preserving malformed/prerelease refusal. Impact: bounded tuple loader prerequisite; rollback: revert the parser change and retain current ranges.
- [ ] L6 handoff: MCP factories still expose fifteen tools and do not consume the L1 profile. L7 tests the bridge against selected-definition fixtures; real four-tool dispatch, actor/envelope parity and the full Radar install remain unqualified until L6 and Q3/Q4.
- [ ] Integration owner: reserve mesh pack-only version, add common-contract export and update artifacts/llm-mesh peer ranges after qualification; manifest and lock changes remain single-writer.

## AI Flaky tests
- [x] No provider-dependent acceptance or timeout changes planned.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**: L7 is an isolated lane; explicitly requested merge integration only.

## UAT Management (in orchestration context)
- [x] No UI change; consumer qualification is the acceptance surface.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read rules, spec r2 and branch template; create isolated worktree; mechanical branch check passed.
  - [x] Merge L1 and L2; inspect the compiled-profile and tuple boundaries.
- [ ] **Lot 1 — Selected mesh composition**
  - [x] Write failing tests in `tests/integrations/artifacts-surface.spec.ts` and `tests/packaging/tuple-skew.spec.ts` before implementation.
  - [x] Derive catalog capabilities from the selected registry definition; refuse manifest drift on load.
  - [x] Expose common data types without claiming common storage admission; scope/fence bindings remain data-only.
  - [ ] Qualify platform envelope and actor-domain behavior through selected dispatch.
- [ ] **Lot 2 — Tuple qualification**
  - [ ] Update the six named tuple/consumer test files only where the contract requires it.
  - [ ] Qualify llm-mesh 0.19.2 and supported boundary fixtures; retain strict install evidence.
  - [ ] Record bounded external consumer gaps without claiming full published qualification.
- [ ] **Lot 3 — Final validation and delivery**
  - [x] `make typecheck-cluster-mesh ENV=test-861-l7`.
  - [x] `make lint-cluster-mesh ENV=test-861-l7`.
  - [ ] `make test-cluster-mesh ENV=test-861-l7` and package packing gates.
  - [ ] Run mechanical scope checks before each atomic commit (under 150 authored lines).
  - [ ] Review the exact diff, resolve findings, push and open a draft PR with this body.
  - [ ] Report PR number and head SHA.
