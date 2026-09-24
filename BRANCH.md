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
- [x] C-FL3 | attention | Owner: conductor | Reversible | h2a checkout `0d6b2eaf` differs from the brief: both named index files mount local proxies; record observed imports separately from the expected newer consumer.
- [x] C-FL4 | attention | Owner: implementation conductor | Reversible | Preserve native dispatch types; add opaque mesh dispatch using BR-73 attempts, keeping provider credentials inside mesh.
- [x] C-FL5 | attention | Owner: implementation conductor | Reversible | Select explicit service or session verification; use trusted identity mapping because auth-hono service context does not expose tenant/OBO claims.
- [x] C-FL6 | attention | Owner: implementation conductor | Irreversible future gate | Real auth-hono integration requires an approved Makefile dependency-wiring exception on the implementation branch; this branch does not grant or perform it.
- [x] C-FL7 | attention | Owner: implementation conductor | Reversible | Production uses request-generated cost correlation and a separately supplied stable affinity; existing custom verifiers retain their published options.
- [x] C-FL8 | attention | Owner: conductor | Reversible | Registry reads confirm gateway 0.17.1 and mesh 0.21.2; independent review, implementation tests and h2a UAT remain future gates, not claimed results.

## AI Flaky tests
- [x] Not applicable: design-only branch; no provider calls or test execution required.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, single writer; no delegated implementation or integration.
- [x] Rationale: one specification and its execution checklist, with external consumer reads only.

## UAT Management (in orchestration context)
- [x] Web app, Chrome plugin, and VSCode plugin UAT not applicable: no runtime behavior changes.
- [x] No services or port reservation required for this planning task.

## Plan / Todo (lot-based)
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
  - [x] Freeze the exhaustive existing-type delta and the nine additive exports in decision D7.
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
