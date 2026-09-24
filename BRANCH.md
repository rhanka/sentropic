# Feature: Cluster mesh single lazy integration surface

## Objective
- [x] Deliver Lot E design and the dated control-plane amendment; implementation and h2a migration belong to later branches.

## Scope / Guardrails
- [x] Planning-only in `tmp/cluster-mesh-lazy-surface`, branch `spec/cluster-mesh-lazy-surface`, base `75032fc85`; mechanical branch check passed.
- [x] Make-only, Docker-first; `ENV=test-cluster-mesh-lazy-surface` last; reserved API_PORT=9425 UI_PORT=5625 MAILDEV_UI_PORT=1525; no services needed.
- [x] No code, migrations, package bumps, push, PR, merge, or publication; English except the explicitly required verbatim owner quote.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `spec/SPEC_EVOL_CLUSTER_MESH_LAZY_SURFACE.md`
  - `spec/SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md` (append-only amendment)
  - `BRANCH.md`
- [x] **Forbidden Paths (must not change in this branch)**: all other files, including `packages/**`, `Makefile`, `docker-compose*.yml`, `.github/workflows/**`, `.track/**` and other plans.
- [x] **Conditional Paths**: none.
- [x] **Exception process**: record `blocked` and stop for an irreversible contract change, migration or infrastructure change; no exceptions authorized.

## Feedback Loop
- [x] E-A1 `attention`, owner: Lot E, 2026-09-23: optional peers plus async loaders preserve native constructors; root declarations stay provider-free, selected leaf types require the peer.
- [x] E-A2 `attention`, owner: Lot E, 2026-09-23: h2a MCP inventory includes external `@sentropic/track/mcp`; private broker/connectors remain gated until publishable contracts exist.
- [x] E-A3 `attention`, owner: conductor, 2026-09-23: independent review remains conductor-owned per brief; no cross-host review or Track recorder artifacts outside the three allowed files, and no consensus claimed.
- [x] E-A4 `attention`, owner: Lot E, 2026-09-23: keep synchronous plugin mounting after async preparation; inject the existing product LLM router because llm-mesh does not export it; preserve D1 and M05.
- [x] E-A5 `attention`, owner: build conductor, 2026-09-23: MCP auth's local oauth-verify dependency needs a public-tarball install gate; refuse activation if unresolved rather than vendor or publish private proofs.
- [x] E-A6 `attention`, owner: Lot E, 2026-09-23: accept tested provider patch ranges within one 0.x minor and reject duplicate LLM instances; widen only with a new compatibility matrix/minor.

## AI Flaky tests
- [x] Not applicable: documentation-only; runtime tests are specified for later implementation, not claimed as run.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, single author; no delegated implementation, cherry-picks or cross-repository edits.

## UAT Management (in orchestration context)
- [x] Web, Chrome and VSCode UAT not applicable; acceptance is source-backed design coverage, scope checks and two atomic documentation commits.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: read required rules/template, README/TODO/PLAN context, control-plane decisions, package exports, registration gates, F1–F7 branch and h2a imports at `75c1dc61`; create this branch plan first.
- [x] **Lot 1 — New specification**: decide loader/type/version/error contracts; map every h2a symbol and MCP import; reconcile namespace mounting and F1; specify migration and implementation lots with file-level tests; commit spec with this checklist.
- [x] **Lot 2 — Amendment**: append dated verbatim decision, translation, preserved D1 and strengthened D14 with spec link; original 495 lines compare byte-for-byte equal; commit amendment with this checklist.
- [x] **Final validation**: PASS `make scope-check API_PORT=9425 UI_PORT=5625 MAILDEV_UI_PORT=1525 ENV=test-cluster-mesh-lazy-surface` before each commit; exact diff/whitespace review; only allowed paths in the two-commit delivery.
- [x] **Cleanup**: PASS `make down API_PORT=9425 UI_PORT=5625 MAILDEV_UI_PORT=1525 ENV=test-cluster-mesh-lazy-surface`; PASS `make ps API_PORT=9425 UI_PORT=5625 MAILDEV_UI_PORT=1525 ENV=test-cluster-mesh-lazy-surface` (no services).
