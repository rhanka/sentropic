# Feature: Cluster-mesh stateful MCP wrapping

## Objective
- [ ] Implement approved #706 blockers 1–3, qualify the twelve Immo tools, and deliver a draft PR.

## Scope / Guardrails
- [x] Base: spec HEAD `8ac9c7c64381c98b1a52d81d6ede8bce2b46ecc7` after rebase; initial creation at `f560d073b9c0d04fd5947e018a7abb2632e302ed`; branch `feat/cluster-mesh-mcp-stateful-wrap`.
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
  - [x] `.github/workflows/ci.yml` (BRWRAP-EX1)
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
- [x] Latest implementation checkpoint: BRANCH.md.
- [x] Rebase retained every package, lock and workflow byte; published versions rechecked at 0.3.0 / 0.19.1, below the selected 0.4.0 / 0.21.0.
- [x] Exact golden JSON files include a trailing blank line in Radar; whitespace checks exclude only these two pinned files to preserve their original bytes.
- [ ] Final review round is incomplete: the security leg declared xhigh instead of the requested high; its verdict is rejected under the review metadata contract. First-round peers completed without blockers; the final conformance leg completed without blockers. No final consensus or merge clearance is claimed.
- [ ] Artifacts maintainer / release dependency: npm lock-only resolution proves ERESOLVE between the new platform 0.4.0 workspace and artifacts 0.1.1's >=0.3.0 <0.4.0 peer. Acceptance: a separately qualified compatible artifacts release and 27-tool installed tuple unblock full-root installation; this branch does not widen that range or bypass npm peer checks. Core package qualification excludes that optional variant.
- [x] BRWRAP-EX1 / CI tuple alignment: change only cluster-mesh qualification in .github/workflows/ci.yml; old explicit platform 0.3.0 pins block the new 0.4.0 contract. Impact: qualify the core tuple and run installed stateful contracts; incompatible optional artifacts remain refused. Rollback: revert the workflow hunk with the package tuple.
- [x] L1: finite JSON budgets and cloned advertised-default traversal extracted from the #689 pattern.
- [x] Fixture import progress: 853/853 exact lines pinned from Radar #866.
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
- [x] **L0 — Pin baseline and inventory**: exact fixture/receipt bytes, hash, twelve calls, HTTP budgets, defaults, auth/expiry rules, public bind seam.
- [x] **L1 — Tool schema validator**: SDK draft-07 compilation/defaults and independent finite JSON budgets; configuration compiler unchanged.
  - [x] Tests: platform `tests/mcp-wire-schema.test.ts`, existing `tests/registry-parameters.test.ts`; positive, negative, defaults, mutation and remote-ref vectors.
- [x] **L2 — Shared native wire dispatch**: complete SDK discovery/results, safe failures/protocol errors, digest-bound registry inputSchema, explicit AppToolResult mode.
  - [x] Tests: platform `tests/mcp-wire-results.test.ts`, `tests/wire-parity.test.ts`, `tests/stdio.test.ts`, `tests/registry.test.ts`; full platform suite: 237 passed.
- [x] **L3 — Stateful composer**: host bind contract, immutable request authority/cancellation, policy/account checks, lazy loaders, preflight, one cached router.
  - [x] Tests: mesh `tests/mcp-stateful-{wrap,lifetime,authority,boundaries}.spec.ts`, `tests/conformance/immo-stateful-wrap.spec.ts`; C1–C7, warm bind and failure barrier. Full mesh suite: 947 passed, 126 infrastructure/packaging tests skipped by their existing environment gates.
- [ ] **L4 — Package qualification**: versions above npm, exports/ranges/locks, API report, READMEs and installed clean consumer C8.
  - [x] Installed core: `tests/packaging/stateful-consumer.sh`, 15 tests plus public TypeScript and missing/version/export/member refusal probes passed; no workspace symlinks or artifacts dependency.
  - [x] Typecheck and lint passed in the cold Docker lanes; published version floors rechecked after rebase. No package was published.
  - [ ] Full-root install/release matrix remains blocked by the separately owned artifacts peer conflict; publication and L5 cutover remain outside this delivery.
- [ ] **Final validation and draft PR**: scope-check before each commit, independent review, diff/whitespace, push and draft using this plan; inspect CI.
