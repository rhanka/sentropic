# Feature: LLM gateway Lot 2 specification

## Objective
- [x] Specify concrete caller authentication, cost-context resolution, and mesh dispatch with exact consumer compatibility and an executable build plan.

## Scope / Guardrails
- [x] Planning only on `spec/llm-gateway-lot2`, worktree `tmp/llm-gateway-lot2`, base `origin/main` at `75032fc85`.
- [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, and `plan/BRANCH_TEMPLATE.md`.
- [x] Make-only checks and commits; `ENV=test-llm-gateway-lot2` last; no services required.
- [x] No code, migrations, package bumps, push, PR, merge, or publication in this branch.
- [x] English text; selective staging; separate `make commit`; approximately 150 changed lines per commit.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `spec/SPEC_EVOL_LLM_GATEWAY_LOT2.md`
  - [x] `BRANCH.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `packages/**`
  - [x] `api/**`
  - [x] `ui/**`
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.github/workflows/**`
  - [x] `.cursor/rules/**`
  - [x] `.track/**`
  - [x] All paths other than the two explicit allowed files; the h2a checkout is read-only.
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] None; any scope expansion requires a new conductor instruction.
- [x] **Exception process**:
  - [x] No exceptions authorized; record irreversible out-of-brief decisions as `blocked` and stop.

## Feedback Loop
- [x] C-FL1 | attention | Owner: conductor | Reversible | Use the EVOL rung directly: the brief fixes the three adapters and authorizes the Lot 2 type migration.
- [x] C-FL2 | attention | Owner: conductor | Reversible | Keep planning and review evidence in these two files; harness recorder/Track writes and separate review artifacts exceed the explicit scope. Independent review remains the conductor's handoff gate.
- [x] C-FL3 | attention | Owner: conductor | Reversible | Corrected from fetched h2a origin/main `75c1dc61`: the brief's imports were correct; both inline verifiers remain assignable, affinity and ledger identity are unchanged, and `^0.17.0` requires a manual 0.18.0 range bump.
- [x] C-FL4 | attention | Owner: implementation conductor | Reversible | Preserve native dispatch types; use RouteAttemptDispatch names to avoid chat-core's different MeshDispatchPort; qualify AuthResolver refresh as native-only, keeping BR-73 credentials/refresh inside mesh.
- [x] C-FL5 | attention | Owner: implementation conductor | Reversible | Select published mcp-auth 0.2.0 `/hono` for service and auth-hono 0.15.0 `/middleware` for session, behind separate optional gateway subpaths; avoid eager root imports and the retiring wrapper. Service context still requires trusted tenant/OBO mapping.
- [x] C-FL6 | attention | Owner: implementation conductor | Irreversible future gate | Real auth-hono integration requires an approved Makefile dependency-wiring exception on the implementation branch; this branch does not grant or perform it.
- [x] C-FL7 | attention | Owner: implementation conductor | Reversible | Production uses request-generated cost correlation and a separately supplied stable affinity; existing custom verifiers retain their published options.
- [x] C-FL8 | attention | Owner: conductor | Reversible | Registry reads confirm gateway 0.17.1 and mesh 0.21.2; independent review, implementation tests and h2a UAT remain future gates, not claimed results.
- [x] C-FL9 | attention | Owner: implementation conductor | Reversible design | Add trusted `publicUrl` and the enumerated `caller-auth-unavailable` union member; private Hono onError preserves store outages as 503, while the deliberate RFC 6750 403-to-401 provider mapping gets separate tests.
- [x] C-FL10 | attention | Owner: implementation conductor | Reversible scope clarification | No quota admission hook exists; budgetScope is carried and over-budget is never emitted in Lot 2. Admission remains with BR-47 / deployable-process Lot D.

## AI Flaky tests
- [x] Not applicable: design-only branch; no provider calls or test execution required.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, single writer; no delegated implementation or integration.
- [x] Rationale: one specification and its execution checklist, with external consumer reads only.

## UAT Management (in orchestration context)
- [x] Web app, Chrome plugin, and VSCode plugin UAT not applicable: no runtime behavior changes.
- [x] No services or port reservation required for this planning task.

## Plan / Todo (lot-based)
- [ ] **Review round 1 — Focused fix groups**
  - [x] R1 — Re-inventory h2a origin/main, correct C-FL3 and document gateway/mesh range effects (findings 1, 11).
  - [x] R2 — Use published canonical service auth and isolate optional auth peers behind subpaths; require npm visibility for all auth dependency floors (findings 2, 3).
  - [x] R3 — Complete public URL/error contracts, Hono failure classification and RFC 6750 deviation tests (findings 4, 5, 12).
  - [x] R4 — Correct quota boundary, dispatch naming and native-only refresh comment (findings 6, 7, 8).
  - [ ] R5 — Enumerate future Makefile wiring and publish order; classify reversible changes versus owner-gated publication (findings 9, 10).
  - [ ] Run scope/whitespace checks per fix group; commit both files; verify final scope, cleanup and log.
- [x] **Lot 0 — Evidence and baseline**
  - [x] Verify branch with `git branch --show-current` and `harness check branch` (PASS C1).
  - [x] Discover Makefile targets and confirm clean initial worktree.
  - [x] Read gateway/BR-73 specs, all three ports, implementations/tests, auth-hono, pool AuthResolver, and both h2a import sites.
  - [x] Inventory exported contracts and distinguish caller credentials from provider credentials.
- [x] **Lot 1 — Caller authentication and cost context**
  - [x] Write Status / Branch / Extends and numbered decisions in `spec/SPEC_EVOL_LLM_GATEWAY_LOT2.md`.
  - [x] Define verifier wiring, claim trust, failure semantics, and cost-context interfaces.
- [x] **Lot 2 — Mesh dispatch**
  - [x] Define the adapter, payload/wire contract, cancellation, errors, and settlement behavior.
  - [x] Identify any required llm-mesh changes and release consequences: no mesh source change required.
- [x] **Lot 3 — Compatibility and implementation handoff**
  - [x] Enumerate existing-type changes and additive root/subpath exports in decision D7; round 1 isolates optional auth types.
  - [x] Enumerate every proposed public type change and impact at each h2a import site.
  - [x] Specify gateway `0.17.1` to `0.18.0`, conditional mesh bump, and migration sequence.
  - [x] Provide ordered implementation lots with existing/new test paths and Make gates.
  - [x] Classify open decisions as reversible or irreversible and record conservative defaults.
- [x] **Lot 4 — Final validation**
  - [x] Review spec consistency against code and both consumer sites; record limitations.
  - [x] Run `make scope-check ENV=test-llm-gateway-lot2` before each commit; PASS C2. Explicit full-file harness scope check also passed.
  - [x] Check whitespace, exact file scope and English commit messages; final clean-status/log verification accompanies handoff.
  - [x] Commit both allowed files through `make commit`; hand off without pushing.
  - [x] Cleanup passed: `make down COMPOSE_PROJECT_NAME=test-llm-gateway-lot2 API_PORT=9380 UI_PORT=5580 MAILDEV_UI_PORT=1480 ENV=test-llm-gateway-lot2`; no application services were started.
  - [x] Cleanup confirmed: `make ps COMPOSE_PROJECT_NAME=test-llm-gateway-lot2 API_PORT=9380 UI_PORT=5580 MAILDEV_UI_PORT=1480 ENV=test-llm-gateway-lot2` passed with an empty service list.
