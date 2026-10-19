# Feature: Cluster-mesh stateful MCP wrapping

## Objective
- [ ] Implement approved #706 blockers 1–3, qualify the twelve Immo tools, and deliver a draft PR.

## Scope / Guardrails
- [x] Base: spec HEAD `f560d073b9c0d04fd5947e018a7abb2632e302ed`; branch `feat/cluster-mesh-mcp-stateful-wrap`.
- [x] Worktree `tmp/worktrees/cm-mcp-stateful-wrap-impl`; ENV=test-cm-wrap; no listening ports or root dev changes.
- [x] Make only, ENV last, no Python, sequential Docker builds, selective staging, make commit, under 150 changed lines per commit.
- [x] Preserve host identity, sessions and ownership; prohibit bearer passthrough, exchange installation and legacy fallback.
- [x] Do not merge or publish; retain BRANCH.md at draft delivery.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`
  - [x] `packages/mcp-platform/**`
  - [x] `packages/cluster-mesh/**`
  - [x] `package-lock.json`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
  - [x] `.track/**`
  - [x] `api/**`
  - [x] `ui/**`
  - [x] `plan/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] `.github/workflows/**`
- [x] Exception process: record BRWRAP-EXn with reason, impact and rollback before changing sensitive paths.

## Feedback Loop
- [ ] Fixture import progress: 325/853 exact lines pinned from Radar #866.
- [x] Radar constraints read: blocker 6 belongs inside 2b-MCP after #706 and #689; exclude #865 before cutover.
- [x] L5 is Radar-owned and gated on published packages/environment receipts/owner GO; this branch qualifies library contracts only.
- [ ] Designated Track writer imports this source plan; this worktree never appends to shared .track.

## AI Flaky tests
- [x] No waiver or added timeout; deterministic package tests.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one builder; read-only independent review before delivery.

## UAT Management (in orchestration context)
- [x] Package transport qualification only; hosted Radar UAT belongs to L5 on the qualified installed tuple.

## Plan / Todo (lot-based)
- [ ] **L0 — Pin baseline and inventory**: exact fixture/receipt bytes, hash, twelve calls, HTTP budgets, defaults, auth/expiry rules, public bind seam.
- [ ] **L1 — Tool schema validator**: SDK draft-07 compilation/defaults and independent finite JSON budgets; configuration compiler unchanged.
  - [ ] Tests: platform `tests/mcp-wire-schema.test.ts`, existing `tests/registry-parameters.test.ts`; positive, negative, defaults, mutation and remote-ref vectors.
- [ ] **L2 — Shared native wire dispatch**: complete SDK discovery/results, safe failures/protocol errors, digest-bound registry inputSchema, explicit AppToolResult mode.
  - [ ] Tests: platform `tests/mcp-wire-results.test.ts`, `tests/wire-parity.test.ts`, `tests/stdio.test.ts`, `tests/registry.test.ts`.
- [ ] **L3 — Stateful composer**: host bind contract, immutable request authority/cancellation, policy/account checks, lazy loaders, preflight, one cached router.
  - [ ] Tests: mesh `tests/mcp-stateful-wrap.spec.ts`, `tests/conformance/immo-stateful-wrap.spec.ts`; C1–C7, warm bind and failure barrier.
- [ ] **L4 — Package qualification**: versions above npm, exports/ranges/locks, API report, READMEs and installed clean consumer C8.
  - [ ] Tests: mesh `tests/packaging/mcp-stateful-consumer.spec.ts`, cold imports/topology/release matrix; platform full suite, mesh full suite, typechecks/lint.
- [ ] **Final validation and draft PR**: scope-check before each commit, independent review, diff/whitespace, push and draft using this plan; inspect CI.
