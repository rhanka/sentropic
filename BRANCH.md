# Feature: Cluster mesh memory MCP builtin

## Objective
- [ ] Expose the six engram memory tools through the selected `sentropic.engram.memory` builtin, composed in-process over the PostgreSQL neutral handle.

## Scope / Guardrails
- [x] Worktree: `tmp/worktrees/memory-mcp-builtin`; branch: `feat/cluster-mesh-memory-mcp`; base: `origin/main`.
- [x] Make-only, Docker-first; shared Docker flock; `ENV=test-memory-mcp` last; shutdown after qualification.
- [x] Candidate: engram 0.22.0, SHA-256 `965c93e326df9866584261061f4e49571cfd74dfe1dc258c0c6894eea121a4e9`.
- [x] No publication or release version depending on unpublished engram; SQLite remains refused.
- [x] All host customization arrives through `definition`; no stub or fallback.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/**`
  - `packages/mcp-platform/src/transport/tool-schemas.ts`
  - `packages/mcp-platform/tests/transport/**`
  - `packages/mcp-platform/package.json`
  - `Makefile`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare rationale, impact and rollback before changing conditional paths.

## Feedback Loop
- [x] BRMEM-EX1: allow Makefile changes for the dedicated PostgreSQL test environment and hash-pinned candidate test provisioning; additive test tooling only; rollback removes those additions.
- [x] Keep the supplied candidate as a hash-checked test-only fixture so CI can qualify identical unpublished peer bytes.
- [x] Record unanswered producer questions in root `.tmp/memory-mcp-builtin/questions.md`; choose the narrowest compatible composition.

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
- [ ] **Lot 1 — Contract tests first**
  - [x] Add `tests/mcp-memory.spec.ts`: static catalog, lazy selection and atomic peer refusal; red: missing builtin entry.
  - [ ] Add `tests/engram-memory/mcp-memory-pg.spec.ts`: all six tools, confirmation guard and two-tenant isolation on real PostgreSQL.
  - [ ] Add transport coverage for stdio and HTTP using the same compiled definition.
  - [ ] Demonstrate expected failures before implementation.
- [ ] **Lot 2 — Qualified builtin and composition**
  - [ ] Add `src/integrations/mcp/memory.ts` and `src/loaders/mcp/memory.ts` with the existing topology guard.
  - [ ] Extend module catalog, contracts, exports and loader barrel.
  - [ ] Compose canonical store, shared engine/read facets and nine bindings through `definition` only.
  - [ ] Preserve producer schemas, receipts, confirmation guard and trusted context.
- [ ] **Lot 3 — Qualification and handoff**
  - [ ] Run focused PostgreSQL and transport tests, typecheck, package build and regression suite.
  - [ ] Run scope check before each atomic commit.
  - [ ] Complete consensus review and reconcile findings.
  - [ ] Document the exact host launch line and required definition bindings.
  - [ ] Open draft PR to main; wait for CI completed/success on exact head.
  - [ ] Run `make down ENV=test-memory-mcp`.

## Deferred to BR-XX
- [x] Publication and release pinning await L5 qualification and published engram 0.22.0.

## Risks / Mitigations
- [x] Missing or incompatible peer refuses selected compilation atomically.
- [x] Candidate-only qualification never silently substitutes a published older peer.

## Rollback Plan
- [x] Remove the optional builtin and its catalog/export entries; retain existing durable storage APIs.
