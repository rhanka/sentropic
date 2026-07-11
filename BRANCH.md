# Feature: llm-mesh GPT-5.6 catalog + Claude Code import (RC for h2a pre-integration)

## Objective
Add the OpenAI GPT-5.6 family (Sol / Terra / Luna) to the `@sentropic/llm-mesh` catalog, and add a non-interactive Claude Code enrollment IMPORT mode (existing local login) at parity with Codex, shipped as a release candidate so h2a can pre-integrate and real-test before the final minor.

## Scope / Guardrails
- Scope limited to `packages/llm-mesh/**` (+ any consumer snapshot/test updates the catalog change forces).
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`); this branch develops in `tmp/feat-wp16-llm-mesh-56-rc`.
- Tests run on isolated docker (`make typecheck-llm-mesh` / `make test-llm-mesh`), never on root `dev`.
- `ENV=<env>` passed as the last `make` argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/**`
  - `packages/llm-mesh/tests/**`
  - `packages/llm-mesh/package.json`
  - `tmp/feat-wp16-llm-mesh-56-rc/BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`
  - consumer snapshot fixtures broken by the additive catalog change (evolution, not regression)

## Lots
- [x] Lot 1 — Catalog: add `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` (advanced, vision) to `providers.ts` + `catalog.ts`. IDs confirmed against OpenAI dev docs.
- [ ] Lot 2 — Claude Code IMPORT mode (non-interactive): read existing local Claude credentials and feed the existing `claude-code-account` AuthInput adapter — DESIGN GATED on h2a reply (where the Codex reader lives; helper in llm-mesh vs h2a-runtime).
- [ ] Lot 3 — Version `0.7.0-rc.0`; publish under npm dist-tag `rc` (NOT `latest`) — verify `publish-llm-mesh` CI supports prerelease dist-tag; add if missing.
- [ ] Lot 4 — `make typecheck-llm-mesh` + `make test-llm-mesh` green (update any catalog snapshot the additive models force).
- [ ] Lot 5 — h2a pre-integration + real `--gw` test on the RC; then final `0.7.0` release.

## Feedback Loop
- BR-EX1: touch `api/tests/api/models.test.ts` (outside `packages/llm-mesh/**`). Reason: the additive GPT-5.6 catalog entries force the consumer's exact-list + count assertions to evolve (openai list +3, total 14→17). Impact: test-only, no runtime code. Rollback: revert the two assertion edits with the catalog change.
- attendu (h2a): how the existing Codex enrollment is imported (file/format/reader location) — sent `env:1783732123000:a8a7` to `claude:a2a-cli:52ebd45f3fe1`. Lot 2 blocked until reply.
- Open decision (owner): make `gpt-5.6-sol` the default OpenAI model (add cutover `gpt-5.5 → gpt-5.6-sol`) or keep 5.6 as opt-in options only. Current: opt-in only (no default change).

## AI Flaky tests
- Accept only non-systematic provider/network nondeterminism as `flaky accepted`, with same-commit success + owner sign-off. No additive timeouts.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: single package (`llm-mesh`), one test cycle; RC publish gated on h2a design + owner default decision.

## UAT Management
- No dev stack required for this branch (pure-lib catalog + tests in isolated docker).
- RC UAT is h2a-side: `@sentropic/llm-mesh@rc` pre-integration + live `--gw` Claude import test.
