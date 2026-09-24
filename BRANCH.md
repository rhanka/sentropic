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
- [x] E-A1 `attention`, owner: Lot E, revised 2026-09-24: select static provider leaves for import substitution and separate additive loaders; native ESM leaf failures cannot provide the loader's typed refusal.
- [x] E-A2 `attention`, owner: Lot E, 2026-09-23: h2a MCP inventory includes external `@sentropic/track/mcp`; private broker/connectors remain gated until publishable contracts exist.
- [x] E-A3 `attention`, owner: conductor, 2026-09-23: independent review remains conductor-owned per brief; no cross-host review or Track recorder artifacts outside the three allowed files, and no consensus claimed.
- [x] E-A4 `attention`, owner: Lot E, 2026-09-23: keep synchronous plugin mounting after async preparation; inject the existing product LLM router because llm-mesh does not export it; preserve D1 and M05.
- [x] E-A5 `attention`, owner: build conductor, revised 2026-09-24: B3 requires publication of mcp-auth 0.2.1 from `fix/mcp-auth-oauth-verify-dep` (`4a8251e1c`, under double review), with oauth-verify `^0.1.0`; exclude broken 0.2.0 and qualify public tarballs with jose `^5.10.0` and Hono.
- [x] E-A6 `attention`, owner: Lot E, revised 2026-09-24: require gateway 0.18 and tested mesh 0.21 patches; loaders reject skew, while static consumers require packed/lockfile coherence gates and one mesh instance.
- [x] E-A7 `attention`, owner: Lot E, revised 2026-09-24: expose Lot C service auth at `/gateway/auth` and session auth at `/gateway/auth-hono`, each with its own loader; gateway root JS/types select neither, keeping service-only consumers independent of auth-hono.
- [x] E-A8 `attention`, owner: h-cond, 2026-09-24: the fifth gateway file at `75c1dc61` is a resolution-test comment, not an import; map all measured files without inventing a fifth import.
- [x] E-A9 `attention`, owner: conductor, revised 2026-09-24: Opus 5.5 returned approve-with-fixes (architecture holds, four majors, no blocker); round 2 addresses those fixes, with final independent acceptance/build handoff still conductor-owned.
- [x] E-A10 `attention`, owner: Lot E, 2026-09-24: release LLM/gateway first, then start MCP after h2a ships that flip; gateway's use of existing mcp-auth is not the later MCP server build.
- [x] E-A11 `attention`, owner: h-cond, 2026-09-24: verify the full 0.9-to-0.10 wire/custody transition and 0.11 feedback before import substitution; the 0.9 changelog already names initial commandRef/custody requirements.

## AI Flaky tests
- [x] Not applicable: documentation-only; runtime tests are specified for later implementation, not claimed as run.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, single author; no delegated implementation, cherry-picks or cross-repository edits.

## UAT Management (in orchestration context)
- [x] Web, Chrome and VSCode UAT not applicable; acceptance is source-backed design coverage, scope checks and atomic documentation commits.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: read required rules/template, README/TODO/PLAN context, control-plane decisions, package exports, registration gates, F1–F7 branch and h2a imports at `75c1dc61`; create this branch plan first.
- [x] **Lot 1 — New specification**: decide loader/type/version/error contracts; map every h2a symbol and MCP import; reconcile namespace mounting and F1; specify migration and implementation lots with file-level tests; commit spec with this checklist.
- [x] **Lot 2 — Amendment**: append dated verbatim decision, translation, preserved D1 and strengthened D14 with spec link; original 495 lines compare byte-for-byte equal; commit amendment with this checklist.
- [x] **Initial validation**: PASS `make scope-check API_PORT=9425 UI_PORT=5625 MAILDEV_UI_PORT=1525 ENV=test-cluster-mesh-lazy-surface` before each initial commit; exact diff/whitespace review; only allowed paths in the initial two-commit delivery.
- [x] **Initial cleanup**: PASS `make down API_PORT=9425 UI_PORT=5625 MAILDEV_UI_PORT=1525 ENV=test-cluster-mesh-lazy-surface`; PASS `make ps API_PORT=9425 UI_PORT=5625 MAILDEV_UI_PORT=1525 ENV=test-cluster-mesh-lazy-surface` (no services).
- [x] **Revision R1a — Consumer contract**: answer all three orientations with arguments; choose static leaves/separate loaders; enumerate all measured h2a sites including node; align Lot C auth isolation and E2–E7.
- [x] **Revision R1b — Upgrade and shipment**: pin gateway 0.18 compatibility; document cluster-mesh 0.9 → 0.10 → 0.11 → lazy minor; ship LLM/gateway before building MCP; revise file-level acceptance.
- [x] **Revision R1c — Authority and validation**: append consumer clarification inside the amendment only; preserve resumed work; PASS branch/scope and whitespace checks, original 495 control-plane lines byte-identical, reviewed diff/history; PASS reserved-environment `make down` and `make ps` with the ports/ENV above (no services). Commit each remaining revision atomically with this checklist; independent review/delivery stays pending below.
- [x] **Revision R2a — Auth entries and release prerequisite**: separate service/session leaves and loaders, require mcp-auth 0.2.1 publication for B3, update the tested tuple, amendment and E-A5/E-A7.
- [ ] **Revision R2b — Startup refusal**: require gateway-relative auth resolution/preload before bind, document static-consumer preflight and the existing runtime-import diagnostic boundary, recognize errors by code, specify absent-peer startup tests.
- [ ] **Revision R2c — Consumer topology and declarations**: require manifest-local selected peers and one physical cluster-mesh, update the 0.9 pin in the same artifact, specify global/separate-runtime and tsup/skipLibCheck fixtures, align leaf paths, hand the rule/test to h-cond and validate the three-file scope.
- [ ] **Review/delivery gate (conductor-owned)**: independent acceptance of round 2 fixes; only then deliver the approved build contract to h-cond (`01M38QMNYJTA3EYZTSV75KB7XM`) and product conductor. The requested topology rule/test notice is informational, not build authorization.
