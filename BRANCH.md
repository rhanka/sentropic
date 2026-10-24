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
- [x] PR735 P2-2: regression observed eager definition construction; catalog metadata now uses only the manifest factory. Full definition construction occurs after qualified module loading, with atomic refusal on loader failure.
- [x] PR735 P2-1: regression caught fifteen handler/value entries in the four-tool fixture; the consistent selected fixture now uses the real module registry and compile path, with exactly four catalog, adapter and compiled tools and no factory mock.
- [x] PR735 P2-3: regression failed on the runtime barrel export; common-contract consumers now import the self-sufficient data leaf directly. Public subpath registration remains integration-owner work.
- [x] BR861-EX2: inherit artifacts changes only through the explicitly requested L1/L2 merges; no authored artifacts edits. Impact: dependency ancestry; rollback: revert the merge. Merge commits retain inherited changes over 150 lines; authored commits remain under 150 lines.
- [x] BR861-EX3: the existing release-range parser rejects the spec-required `0.19.2 || >=0.22.0 <0.28.0`; extend only alternative parsing, preserving malformed/prerelease refusal. Impact: bounded tuple loader prerequisite; rollback: revert the parser change and retain current ranges.
- [ ] L6 handoff: MCP factories still expose fifteen tools and do not consume the L1 profile. Owner: L6 author. Scope: MCP factory/adapter wiring and profile digest in registry integrity evidence. Acceptance: one compiled profile drives four-tool manifest, adapter, handlers and schemas; argument/envelope and actor-domain fixtures pass. L7 selected-definition tests are bridge fixtures, not real four-tool provider qualification.
- [ ] Integration-owner handoff: reserve mesh pack-only version; add `./storage/common-contract` export; update artifacts peer/catalog to `>=0.2.0 <0.3.0` and llm-mesh peer/catalog to `0.19.2 || >=0.22.0 <0.28.0`; refresh locks with one writer. Acceptance: ordinary bump gate, catalog/manifest parity and strict full-Radar install pass. No source-package publication is authorized here.
- [ ] Consumer handoff: i-cond/Q3/Q4 supplies the qualified full Radar tree and pinned lock/image after L6. Acceptance: strict install without force/legacy peer flags, sixteen-tool composition and both transport replay directions. The source/packed baseline tuple is not an artifacts 0.2.0 qualification receipt.
- [x] Published `@sentropic/llm-mesh@0.19.2` surface probe: all five catalog entries (`llm-mesh`, facade, enrollment, node, cloud-code transport) imported with zero missing required members in a clean container. Command: `make -f /tmp/861-L7.mk qualify-llm0192 ENV=test-861-l7`; probe SHA-256 `6270321d9a894997bcde652493fd59e11b4c74c0b0b835b2eb60115335a18a31`. This proves entry compatibility only, not the full Radar tuple.
- [x] `make pack-cluster-mesh ENV=test-861-l7`: PASS standalone manifest guard; current mesh 0.21.2 archive SHA-256 `9634e4d34870b49efc77b170f06b3a202331412597e4a39b51dc3996e7815580`.
- [x] First full mesh run: 1083 passed, 129 environment-gated skips, one SQLite second-holder timeout (5000 ms). `make test-cluster-mesh SCOPE=tests/storage/sqlite-corpus.spec.ts ENV=test-861-l7`: 4/4 pass unchanged. No timeout or SQLite implementation changes; full rerun required.
- [ ] Full-suite gate remains RED after three runs: 1083/1082/1083 passes, 129 gated skips each, and 1/2/1 SQLite timeouts. Failures moved between sqlite-corpus, sqlite-capabilities/sqlite-lanes, and instance-ownership; observed host load was 22–38. No root cause or flaky acceptance is claimed. Owner: storage maintainer/integration owner; bounded scope: reproduce SQLite child-process timing in the shared runner, outside L7 paths. Acceptance: original `make test-cluster-mesh ENV=test-861-l7` passes unchanged, without timeout increases or skipped tests.
- [x] Draft PR #735 opened against L3; source diff inspected; no authored artifacts edits or manifest/lock writes. Branch/worktree gates passed, every authored commit is below 150 changed lines.

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
  - [x] Record bounded external consumer gaps without claiming full published qualification.
- [ ] **Lot 3 — Final validation and delivery**
  - [x] `make typecheck-cluster-mesh ENV=test-861-l7`.
  - [x] `make lint-cluster-mesh ENV=test-861-l7`.
  - [ ] `make test-cluster-mesh ENV=test-861-l7`: full-suite SQLite failures remain unresolved; all 12 artifacts-surface tests pass in each full run.
  - [x] `make pack-cluster-mesh ENV=test-861-l7`.
  - [x] Run mechanical scope checks before each atomic commit (under 150 authored lines).
  - [x] Inspect the exact diff, push and open draft PR #735 with this body; merge/release review remains pending with the integration prerequisites.
  - [x] Report PR #735 and the final head SHA in the delivery response.
