# Feature: WP-BENCH — Competitive benchmarks across Sentropic's functional perimeter

## Objective
Inscribe a perennial workpackage (WP-BENCH) in track dedicated to competitive "best-of" benchmarks per
functional perimeter (agentic framework+engine, MCP, mesh/gateway, chat-ui, harness, canvas; CLI delegated
to h2a), with the twin finality: virtuous/reversible AND at least as functional as the best of each field.
Docs-only + track inscription; no code, no tests.

## Scope / Guardrails
- Docs + track inscription only. NO code, NO migration, NO CI change.
- Make-only workflow (none needed here — no service starts).
- Branch development in isolated worktree `tmp/chore-wp-benchmarks`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_STUDY_BENCHMARKS_FUNCTIONAL_PERIMETER.md` (NEW)
  - `.track/**` (track inscription via the `track` CLI only — append-only)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - any `api/**`, `ui/**`, `e2e/**`, `packages/**`, other `spec/**`, `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - none
- **Exception process**:
  - Declare `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `WP-BENCH-FL1` (interpretation) — owner note "les autres workpackage devraient etre un workpackage":
  interpreted as WP-BENCH = ONE cross-cutting WP whose themes mirror the existing delivery WPs
  (DATA/FRAME/RESP/CHATUI/APP/KNOW); each theme's parity gap feeds the owning WP. Surfaced for
  ratification at merge.
- `WP-BENCH-FL2` (delegation) — the CLI theme is delegated to h2a's own benchmark; kept as a
  cross-reference + seam only, per owner instruction.

## AI Flaky tests
- Not applicable (docs + track only; no test suite).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** — single orthogonal docs+track chore.
- [ ] **Multi-branch**
- Rationale: one document + one track WP with per-theme children; no independent CI.

## UAT Management (in orchestration context)
- No UI/E2E surface. Owner review of the benchmark doc + WP structure is the acceptance.

## Plan / Todo (lot-based)
- [x] **Lot 0 - Baseline & constraints**
  - [x] Branch from `origin/main` in isolated worktree `tmp/chore-wp-benchmarks`.
  - [x] Read live track WP set (DATA/FRAME/RESP/CHATUI/APP/KNOW) to align themes.
  - [x] Read existing deep-dive `SPEC_STUDY_AGENTIC_FRAMEWORK_CLI_BENCHMARK.md` to avoid duplication.

- [x] **Lot 1 - Benchmark doc (best-of per theme)**
  - [x] `spec/SPEC_STUDY_BENCHMARKS_FUNCTIONAL_PERIMETER.md`: WP charter + per-theme best-of + criteria +
        Sentropic position + parity gap + reversibility scorecard + mapping to owning WPs.

- [x] **Lot 2 - Double consensus (Opus + Codex)**
  - [x] Opus adversarial review (SHIP-WITH-FIXES) + Codex second-opinion (SHIP-WITH-FIXES), converging.
  - [x] Reconciled into the doc: real reversibility grid; every over-claim tempered to evidence (mesh
        0.6.0; SKIP-LOCKED = gateway port contract; mcp-platform private/unpublished; canvas partial;
        harness ahead-on-method/gap-on-parity; MCP at-parity-auth/gap-rest); added SWE-bench/Terminal-Bench,
        caching+guardrails, transport+elicitation, generative-UI+a11y/SSR, memory/eval/interop criteria;
        added missing competitors; delegated-benchmark contract for CLI. Provenance recorded in the doc.

- [x] **Lot 3 - Track inscription**
  - [x] Created WP-BENCH parent (`role:workpackage`, `01KX4K287GZYE8TV8XHTRK47JF`, accountable=conductor).
  - [x] Created 7 child benchmark items (Bench T1..T7; T7 = CLI delegated to h2a) under WP-BENCH.
  - [x] Verified via `track query --role workpackage` + `track item ls` — WP-BENCH is the 7th WP with its
        7 theme leaves; `%` rolls up from leaves (all TO-DO at inscription).

- [ ] **Lot N - PR**
  - [ ] PR (body = this BRANCH.md); remove BRANCH.md at merge per workflow.
