# Feature: Google Drive and Gmail MCP adapter proofs

## Objective
Deliver Google Drive and Gmail read-only provider adapters against the frozen `@sentropic/mcp-platform` contract, preserving fixture proofs and adding an opt-in live API execution path.

## Scope / Guardrails
- Scope is limited to the new connector package, this branch plan, and the two requested Makefile targets.
- Fixture adapters and tests remain hermetic; the opt-in live smoke alone performs real Google API calls. No OAuth runtime, API import, migration, gateway, or mesh work.
- Connector access is by `ctx.getSecret('googleOAuthAccessToken')`; secret values are never logged, emitted, or returned.
- Make-only workflow; test only with `ENV=test-mcp-google` as the last argument.
- All new text is English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/mcp-connector-google/**`
  - `BRANCH.md`
  - `Makefile` under `BR72-EX1`
- **Forbidden Paths (must not change in this branch)**:
  - `api/**`
  - `packages/mcp-platform/**`
  - `packages/mcp-connector-*/**` except `packages/mcp-connector-google/**`
  - `package-lock.json`
  - migrations, gateways, and mesh code
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`

## Feedback Loop
- [x] `BR72-EX1` — Makefile touch is required solely to add the private-package quality and opt-in live-smoke targets; impact is limited to the existing Docker pattern, and rollback is removal of those targets.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one bounded adapter package against a frozen contract.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Frozen-contract baseline**
  - [x] Verify the branch with `harness check branch` and `git branch --show-current`.
  - [x] Read the frozen runtime and manifest contracts, Google Drive API reference, and GitHub benchmark pattern.
  - [x] Confirm package-only scope and declare `BR72-EX1` before changing `Makefile`.
- [x] **Lot 1 — Private Google adapter package**
  - [x] Add separate Google Drive and Gmail read-only manifests and provider adapters.
  - [x] Add synthetic capability fixtures, account-mount documentation, and a public package entry point.
  - [x] Add hermetic Vitest coverage for read-only declarations, discovery, fixtures, audit IDs, secret-by-reference, and state-only secret status.
  - [x] Lot gate: `make typecheck-mcp-connector-google`.
  - [x] Lot gate: `make test-mcp-connector-google ENV=test-mcp-google`.
- [x] **Lot 2 — Scope and handoff validation**
  - [x] Verify no real network call, API import, or secret logging occurs in the package source.
  - [x] Run `make scope-check` before commit.
  - [x] Commit the bounded change via `make commit` and verify a clean worktree.
- [x] **Lot 3 — Opt-in Google live execution**
  - [x] Add real Google Drive and Gmail read-only executors, adapters, and broker that reuse the existing manifests and resolve only `googleOAuthAccessToken` by reference.
  - [x] Add hermetic fetch-mocked coverage for every live capability, typed failures, token redaction, and unsafe identifier rejection.
  - [x] Add the opt-in Docker smoke target and verify its no-token skip path.
  - [x] Run package typecheck, full package tests, scope check, and commit the bounded change.
