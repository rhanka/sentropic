# Feature: Cluster mesh memory MCP builtin

## Objective
- [x] Expose the six engram memory tools through the selected `sentropic.engram.memory` builtin, composed in-process over the PostgreSQL neutral handle.

## Scope / Guardrails
- [x] Worktree: `tmp/worktrees/memory-mcp-builtin`; branch: `feat/cluster-mesh-memory-mcp`; base: `origin/main`.
- [x] Make-only, Docker-first; shared Docker flock; `ENV=test-memory-mcp` last; shutdown after qualification.
- [x] Published peer: `@sentropic/engram` 0.22.0 from npm, integrity `sha512-888akd0XH+ODAEU65QMLvAZLDfdgwiLlx4EiiFFy3Go+cWhLm22z48HKq2NardQ32rJm5bOIhqlwKLTnjcO+1w==`; source `2bd7da41779305831b16c94f1272ab3b9d38128e`. The local candidate tarball pin is replaced; the 14 MB fixture file is removed.
- [x] Release version 0.25.0 on the published peer per owner release instruction; this builtin is PostgreSQL-only for milestone 1; SQLite is milestone 2.
- [x] All host customization arrives through `definition`; no stub or fallback.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/**`
  - `packages/mcp-platform/src/transport/tool-schemas.ts`
  - `packages/mcp-platform/tests/transport/**`
  - `packages/mcp-platform/package.json`
  - `Makefile`
  - `package.json`
  - `package-lock.json`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `scripts/ci/tool-locks.json`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare rationale, impact and rollback before changing conditional paths.

## Feedback Loop
- [x] Rebased onto origin/main; retain the memory branch plan when resolving its conflict with the unrelated plan on main.
- [x] Reproduced SDK tools/list rejection for all six raw outputSchema roots; advertise object roots without changing producer validation or the unpublished release version.
- [x] Qualify `tests/engram-memory/mcp-memory-sdk.spec.ts`: real SDK discovery, all six calls, malformed input and confirmation refusal through a generic builtin consumer.
- [x] After rebase: source/test typechecks, build, lint, 1425 general tests and 13 required MCP tests pass; the separate-process launcher passes all six tools; isolated containers stopped.
- [x] BR01-EX1: allow Makefile changes for the dedicated PostgreSQL test environment and hash-pinned candidate test provisioning; additive test tooling only; rollback removes those additions.
- [x] BR01-EX2: allow `.github/workflows/ci.yml` to require the isolated memory MCP PostgreSQL campaign when validating cluster-mesh; rollback removes the added step; no publication or release-gate exemption.
- [x] BR01-EX3 (superseded by EX4): update root workspace optional peer metadata only; retain the frozen 0.21.3 substrate development lock. The Docker qualification explicitly installs the hash-pinned 0.22.0 peer; no runtime fallback. Rollback restores those metadata entries.
- [x] BR01-EX4: release on the published engram 0.22.0. Rationale: owner packet orders the npm pin, the minor bump and the CI tuple fix; engram 0.22.0 is published with verified integrity. Impact: `packages/cluster-mesh/package.json` 0.24.0→0.25.0 and devDep 0.22.0; root `package.json` override re-keyed to `@sentropic/engram@0.22.0`; root `package-lock.json` surgical swap (links intact); `Makefile` peer-tools tarball→npm and install-lane PEERS; `.github/workflows/ci.yml` two PEERS tuples plus re-added memory campaign step (new lane structure); `scripts/ci/publishable-ci-wiring.test.mjs` tuple constant and new `tool-locks.json` shallow profile for the published peer set. Conditional-path-adjacent files (`scripts/ci/*`, root `package.json`) change only for this packet-mandated tuple/pin. Rollback: revert this lane's packets to 0.24.0/0.21.3 pin set and restore the fixture tarball from git history.
- [x] Keep the supplied candidate as a hash-checked test-only fixture so CI can qualify identical unpublished peer bytes. SUPERSEDED: peer published; fixture pin replaced by the npm 0.22.0 pin with committed lock integrity; tarball file removed.
- [x] Carry the inherited `BRLOCK-EX1 review_by=2026-11-30T00:00:00Z` lockfile-scope exemption record (owner: CI maintainers; remove when PR 846 closes) so the #846 lockfile guard finds the active exemption in this plan; this branch touches the exempted Makefile/workflow paths only through the declared BR01-EX2/EX4 entries.
- [x] Record unanswered producer questions in root `.tmp/memory-mcp-builtin/questions.md`; choose the narrowest compatible composition.
- [x] Repin the shared-chunk candidate from Engram source `2bd7da41779305831b16c94f1272ab3b9d38128e`; preserve the atomic split-engine/provenance refusal test and private gate.
- [x] UNBLOCKED — Engram 0.22.0 published (integrity verified against the owner packet). cluster-mesh bumped 0.24.0→0.25.0; enforce-package-bump, manifest-guard tuple, pack-cluster-mesh, API typecheck and toolbox build failures from run 40986944389 are addressed at the root cause (published peer pin + tuple + bump).
- [x] Rebased onto origin/main `8ea119c4d` then again onto `2290fea3d` (35 commits replayed on the final base). ci.yml had been rewritten to the package-candidates lane structure: the memory MCP campaign step is re-added after the isolated package lane (BR01-EX2 preserved); BRANCH.md conflicts kept the memory plan; Makefile/cold-workspace conflicts merged by union (locked-tools installs, mesh-check lane, memory-mcp/memory-mcp-static/memory-mcp-launcher cases kept).
- [x] npm 11 arborist drops the mcp-broker/mcp-platform workspace links when engram 0.22.0 (exact optional peers on those workspaces) joins the ideal tree alongside regular dependents. Root lock repaired by surgical transplant (main lock + engram 0.22.0 subtree + 0.25.0 mesh entry); links verified intact; full-regen drift avoided. Minimal repro retained in /tmp (wsrepro2).
- [x] Static validation: lint, source/test typechecks, build and launcher syntax pass; expanded PostgreSQL regression lane: 215 files, 1612 tests pass; 58 existing conditional cases remain outside this lane.
- [x] Initial expanded run timed out in `tests/storage/instance-ownership.spec.ts`; unchanged focused rerun passes all 13 cases, then the complete expanded lane passes. No timeout increase or exemption.
- [x] Release-lane expanded run timed out in `tests/storage/sqlite-s0-identity.spec.ts` (5000 ms) under concurrent host load; unchanged focused rerun passes 3/3 (worst case 465 ms). No timeout increase or exemption.
- [x] Release bump widens the comments leaf range to `>=0.21.0 <0.26.0`; `tests/modules/registry.spec.ts` refuses the next unqualified minor at `0.26.0` now that `0.25.0` is the released leaf version.
- [x] Positive qualification: six required PostgreSQL/stdio/HTTP tests and six static/lazy/refusal tests pass; no required case is skipped. Forget replay preserves its receipt.
- [x] Fix the directly exposed consumer lexical-index adapter: preserve the canonical null tombstone and mutable projection bytes under the existing admitted index identity; commit proofs and provenance remain enforced.
- [x] Owner-required Muse Wonder full xhigh review completed with two independent lenses, validation/security and discovery/integration; both approve with no blocker. Initial sandbox session-lock failures retained in `.h2a/reviews/memory-sdk-dossier.md`; successful reruns used the required runtime permission. No distinct-model harness consensus is claimed.

## AI Flaky tests
- [x] No accepted flaky tests; no timeout increases.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; isolated implementation and final consensus review.

## UAT Management (in orchestration context)
- [x] Validate the six-tool catalog over stdio and HTTP, transport captures, and all six tool lifecycles through the separate-process stdio launcher.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and contracts**
  - [x] Read common rules, binding specification, handoff, launch contract and host bindings.
  - [x] Create isolated worktree and pass mechanical harness branch check.
  - [x] Verify published engram 0.22.0 integrity against the owner packet (`sha512-888a…`); tarball pin replaced.
- [x] **Lot 1 — Contract tests first**
  - [x] Add `tests/mcp-memory.spec.ts`: static catalog, lazy selection and atomic peer refusal; red: missing builtin entry.
  - [x] Add `tests/engram-memory/mcp-memory-pg.spec.ts`: all six tools, confirmation guard and two-tenant isolation on real PostgreSQL.
  - [x] Add transport coverage for stdio and HTTP using the same compiled definition.
  - [x] Demonstrate candidate refusal and the real PostgreSQL forget failure before their corresponding fixes.
- [x] **Lot 2 — Qualified builtin and composition**
  - [x] Add `src/integrations/mcp/memory.ts` and `src/loaders/mcp/memory.ts` with the existing topology guard.
  - [x] Extend module catalog, contracts, exports and loader barrel.
  - [x] Compose canonical store, shared engine/read facets and nine bindings through `definition` only.
  - [x] Preserve producer schemas, receipts, confirmation guard and trusted context.
- [ ] **Lot 3 — Qualification and handoff**
  - [x] Pass lint, source/test typechecks, package build, launcher syntax and the unit/regression suite in isolated Docker.
  - [x] Pass all six positive PostgreSQL and transport tests plus the atomic split-provenance refusal.
  - [x] Pass a separate-process round trip through `examples/memory-mcp-stdio.mjs` with the explicit PostgreSQL fixture host.
  - [x] Typecheck the launcher host, context and dependency fixtures with the emitted library; require compiler success before launching.
  - [x] Run mechanical scope checks; final full branch diff passes C2.
  - [x] Complete the owner-required two-lens Muse review and reconcile findings.
  - [x] Document the exact host launch line and required definition bindings in `packages/cluster-mesh/docs/memory-mcp.md`.
  - [x] Open draft PR to main: https://github.com/rhanka/sentropic/pull/844.
  - [ ] Wait for CI completed/success on exact head (new run after the release packet; run 40986944389 failure causes fixed).
  - [x] Run `make down ENV=test-memory-mcp`; isolated project has no remaining containers.

## Deferred to BR-XX
- [x] Publication and release pinning awaited L5 qualification and published engram 0.22.0 — both met; pinning done in this lane.

## Risks / Mitigations
- [x] Missing or incompatible peer refuses selected compilation atomically.
- [x] Published-peer qualification installs the registry 0.22.0 pin with committed integrity; no older or unpublished peer is substituted.

## Rollback Plan
- [x] Remove the optional builtin and its catalog/export entries; retain existing durable storage APIs.
