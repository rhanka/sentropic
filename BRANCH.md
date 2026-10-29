# Feature: Cluster mesh memory MCP builtin

## Objective
- [ ] Expose the six engram memory tools through the selected `sentropic.engram.memory` builtin, composed in-process over the PostgreSQL neutral handle.

## Scope / Guardrails
- [x] Worktree: `tmp/worktrees/memory-mcp-builtin`; branch: `feat/cluster-mesh-memory-mcp`; base: `origin/main`.
- [x] Make-only, Docker-first; shared Docker flock; `ENV=test-memory-mcp` last; shutdown after qualification.
- [x] Candidate: engram 0.22.0, SHA-256 `0e740e5c8fd9d8bc167d6efcdd0e2bf86a2af5c6accfc2bc1c464e4477b14f08`; source `2bd7da41779305831b16c94f1272ab3b9d38128e`.
- [x] No publication or release version depending on unpublished engram; this builtin is PostgreSQL-only for milestone 1; SQLite is milestone 2.
- [x] All host customization arrives through `definition`; no stub or fallback.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/**`
  - `packages/mcp-platform/src/transport/tool-schemas.ts`
  - `packages/mcp-platform/tests/transport/**`
  - `packages/mcp-platform/package.json`
  - `Makefile`
  - `package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare rationale, impact and rollback before changing conditional paths.

## Feedback Loop
- [x] BR01-EX1: allow Makefile changes for the dedicated PostgreSQL test environment and hash-pinned candidate test provisioning; additive test tooling only; rollback removes those additions.
- [x] BR01-EX2: allow `.github/workflows/ci.yml` to require the isolated memory MCP PostgreSQL campaign when validating cluster-mesh; rollback removes the added step; no publication or release-gate exemption.
- [x] BR01-EX3: update root workspace optional peer metadata only; retain the frozen 0.21.3 substrate development lock. The Docker qualification explicitly installs the hash-pinned 0.22.0 peer; no runtime fallback. Rollback restores those metadata entries.
- [x] Keep the supplied candidate as a hash-checked test-only fixture so CI can qualify identical unpublished peer bytes.
- [x] Record unanswered producer questions in root `.tmp/memory-mcp-builtin/questions.md`; choose the narrowest compatible composition.
- [x] Repin the shared-chunk candidate from Engram source `2bd7da41779305831b16c94f1272ab3b9d38128e`; preserve the atomic split-engine/provenance refusal test and private gate.
- [ ] BLOCKED — Published engram is still 0.21.3; retain cluster-mesh 0.24.0 per owner instruction. The release bump gate cannot pass for this draft without a changed publication prerequisite.
- [x] Static validation: lint, source/test typechecks, build and launcher syntax pass; unit lane: 159 files, 1420 tests pass; 245 existing conditional tests are outside this unit lane.
- [x] Positive qualification: six required PostgreSQL/stdio/HTTP tests and six static/lazy/refusal tests pass; no required case is skipped. Forget replay preserves its receipt.
- [x] Fix the directly exposed consumer lexical-index adapter: preserve the canonical null tombstone and mutable projection bytes under the existing admitted index identity; commit proofs and provenance remain enforced.
- [ ] Consensus review pending: Muse startup failed on its read-only session directory; automatic approval review rejected the Gemini Argon fallback's external source-code payload. No consensus verdict is claimed.

## AI Flaky tests
- [x] No accepted flaky tests; no timeout increases.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; isolated implementation and final consensus review.

## UAT Management (in orchestration context)
- [ ] Validate the same six tools over stdio and HTTP against the exact branch head.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and contracts**
  - [x] Read common rules, binding specification, handoff, launch contract and host bindings.
  - [x] Create isolated worktree and pass mechanical harness branch check.
  - [x] Verify candidate tarball hash.
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
  - [x] Run mechanical scope checks; final full branch diff passes C2.
  - [ ] Complete consensus review and reconcile findings.
  - [x] Document the exact host launch line and required definition bindings in `packages/cluster-mesh/docs/memory-mcp.md`.
  - [x] Open draft PR to main: https://github.com/rhanka/sentropic/pull/844.
  - [ ] Wait for CI completed/success on exact head; producer closure and release prerequisites remain blocking.
  - [x] Run `make down ENV=test-memory-mcp`; isolated project has no remaining containers.

## Deferred to BR-XX
- [x] Publication and release pinning await L5 qualification and published engram 0.22.0.

## Risks / Mitigations
- [x] Missing or incompatible peer refuses selected compilation atomically.
- [x] Candidate-only qualification never silently substitutes a published older peer.

## Rollback Plan
- [x] Remove the optional builtin and its catalog/export entries; retain existing durable storage APIs.
