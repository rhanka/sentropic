# Feature: Sentropic-app capitalisation inventory & action plan

## Objective
Produce a docs-only inventory reconciling the capitalised `@sentropic/*` packages
with their REAL integration / production status inside `sentropic-app`
(`api/`, `ui/`, `apps/auth-idp/`), mapped against `track`, plus a prioritized,
collision-aware action plan and a proposed set of capitalisation work-packages.
No runtime code changes.

## Scope / Guardrails
- Scope limited to documentation of existing state (read-only analysis of code).
- No migration, no `api/drizzle/*.sql` change.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/chore-app-capitalisation`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `docs/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`, `ui/**`, `packages/**`, `apps/**` (no runtime/source change)
  - `plan/NN-BRANCH_*.md` (except a mirror of this branch file if added)
- **Conditional Paths (allowed only with explicit exception)**:
  - `track/**` (only additive registry note, via track CLI — declare BRxx-EXn)
  - `plan/**` (only a mirror branch file — declare BRxx-EXn)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- BRcap-N1 (info, conductor): delegation substitutions — `gpt-5.5-codex` unavailable on ChatGPT account (build ran on `gpt-5.6-terra` xhigh); review on `gpt-5.6-sol` xhigh + Opus 4.8. Gemini CLI returned HTTP 400 (auth/quota) → small-bit qualification fell back to Claude sonnet sub-agents. Rollback: none needed (docs-only).
- BRcap-N2 (attention, owner): the inventory surfaces 4 P1 owner-decisions/triage (NOT dispatchable builds) — (1) LLM egress direction (gateway vs sanctioned mesh-direct; two overlapping specs); (2) UBO registry BR-59 activate-or-park (after BR-50); (3) mcp-platform activation label conflict BR-72 (live sidecar "PROVIDER activation" vs origin/main broker spec "benchmark matrix"); (4) cited-source-viewer activate-or-park. See docs §6/§7.

## AI Flaky tests
- Not applicable (docs-only branch; no test campaign).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (docs-only, orthogonal; single final review cycle)
- [ ] **Multi-branch**
- Rationale: Single markdown deliverable; conductor fans out fact-gathering + review
  to sub-agents (Codex/Opus) but integrates on one branch.

## Delegation Plan (conductor)
- Fact-gathering (per-package runtime-usage sheets): delegated sub-agents (small bits).
- Doc build: Codex `gpt-5.6-terra` xhigh in background (`gpt-5.5-codex` unavailable on ChatGPT account — substituted).
- Doc review (spec-grade): Codex `gpt-5.6-sol` xhigh + Claude Opus 4.8 xhigh, adversarial.
- Gemini delegation intended but unavailable (CLI returns HTTP 400 on this account) — small bits fell back to Claude sub-agents.
- Conductor (this session): scope, orchestration, reconciliation, final integration, track mapping.

## Lots
- [x] Lot 0 — Branch + worktree + BRANCH.md (scope declared)
- [x] Lot 1 — Fact-gathering fan-out (5 clusters, Claude sonnet sub-agents)
- [x] Lot 2 — Build inventory doc `docs/sentropic-app-capitalisation-inventory.md` (Codex 5.6-terra)
- [x] Lot 3 — Adversarial review ×2 (Codex 5.6-sol REWORK + Opus 4.8 SHIP-AFTER-FIXES) + conductor reconciliation
- [x] Lot 4 — Final doc integrated + committed (track mapping is §6/§7 of the doc; no parallel WP written to track)
