# Fix: gateway codex 503s (param + error masking + misdiagnosis)

## Objective
Fix the three codex-proven gateway defects (env:send:6e98bd1e): (D1) Codex transport sends rejected `max_output_tokens`; (D2) upstream 400 invalid overwritten into 503 pooled-account-unavailable (fake 529s); (D3) planner surfaces unrelated `[0]` diagnostic (parasite muse reauth on codex requests). Minimal fixes + regressions.

## Scope / Guardrails
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` reserved for user dev/UAT (`ENV=dev`), must remain stable.
- Branch work in isolated worktree `tmp/gateway-503`.
- Automated tests on dedicated envs (`ENV=test` / `ENV=e2e`), never root dev.
- UAT branch/worktree must be commit-identical to the qualified branch (same HEAD SHA).
- In every `make` command, `ENV=<env>` as last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/src/transport/codex-runtime-wire.ts`
  - `packages/llm-mesh/src/route-planner.ts`
  - `packages/llm-mesh/src/route-selection.ts` (export-only: resolver reuse for D3)
  - `packages/llm-gateway/src/route-stream-flow.ts`
  - `packages/llm-gateway/src/route-json-flow.ts`
  - `packages/llm-gateway/src/route-flow-core.ts` (shared terminal-class helper + pre-content invalid classification, BR77 §2)
  - `packages/llm-gateway/src/router/errors.ts`
  - `packages/llm-gateway/tests/errors.test.ts` (mapper unit shapes for new terminal classes)
  - `packages/llm-gateway/tests/contract-snapshot.test.ts` (freeze golden for new §3b rows, same-PR edit)
  - `packages/llm-mesh/tests/transport/codex-runtime-wire.test.ts`
  - `packages/llm-mesh/tests/route-planner*.test.ts`
  - `packages/llm-gateway/tests/route-*.test.ts`
  - `packages/llm-gateway/tests/router-errors*.test.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-gateway/package.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/llm-mesh/src/enrollment/*`
  - `packages/llm-mesh/src/service/*`
  - `packages/llm-mesh/src/transport/muse-runtime-client.ts`
  - `api/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare `BR77-EXn` in `## Feedback Loop` before touching conditional/forbidden paths.

## Feedback Loop
- `acknowledge` BR77-D1 (codex env:send:6e98bd1e, owner-ordered): 3 defects with A/B proofs against installed 0.21.1/0.15.0 — (1) max_output_tokens 400, (2) 400→503 masking (fake 529), (3) parasite muse diagnostic. Minimal fixes + regressions, demo + versions for h2a after.
- `acknowledge` BR77-D2 (evidence): D1 root confirmed on origin/main (`codex-runtime-wire.ts:84-85` emits the param, no strip); D2 confirmed (`route-stream-flow.ts` throws pooled-account-unavailable after exhausting, discarding classification); D3 confirmed (`route-planner.ts:137` takes `listDiagnostics[0]` unrelated to request).
- `acknowledge` BR77-D3 (self-audit): TEST2-era "Meta capacity" reading was wrong on masked 400s; stale-branch reads corrected — verify on origin/main always.
- `acknowledge` BR77-R1 (astra xhigh review, VERDICT: KO): 3 blocking P2 beyond D1-D3 — (a) planner ignores `input.explicit` (parasite muse persists on explicit codex), (b) terminal 401/403/429 collapse to pooled 503 + Retry-After lost, (c) pre-content SSE `response.failed` invalid_request_error classified provider-5xx. 25 probes: 8 pass, 17 fail.
- `resolve` BR77-R1 (TDD red→green, commit 99d38bea0): (a) explicit transport restriction wins in planner empty-branch; (b) shared `terminalGatewayError` helper + new `upstream-auth-failed`/`upstream-rate-limited` classes (401 auth_error / 429 rate_limit + Retry-After, both wires); (c) code-based invalid classification (`invalid_request*`, `invalid_api_key` excluded). Probes 25/25 green; suites mesh 253 + gateway 121; typechecks + lints green; scope PASS; contract-snapshot golden extended in same PR.
- `acknowledge` BR77-R2 (astra xhigh re-review, VERDICT: OK): all 4 points FIXED with evidence, round-1 fix maintained, no out-of-scope change. Merge authorized by owner on review OK.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: three small adjacent fixes, one test cycle.

## UAT Management (in orchestration context)
- UAT on integrated branch only; checkpoints as checkboxes per lot.

## Plan / Todo (lot-based)
- [x] **Lot 1 — D1: omit max_output_tokens for Codex (TDD red→green)**
  - [x] Red test: `buildCodexRuntimeRequest` with `maxOutputTokens` omits the param (others keep it).
  - [x] Fix in `codex-runtime-wire.ts` (codex only, no cross-transport change).
  - [x] Lot gate: mesh 252/252, gateway 116/116, typechecks + lints green.
- [x] **Lot 2 — D2: preserve upstream invalid refusal (TDD red→green)**
  - [x] Red tests: 400 invalid non-retryable → surfaced as 400 invalid_request_error (json + stream before first content); auth/quota/unavailability distinguished; retryable preserved.
  - [x] Fix in `route-stream-flow.ts` / `route-json-flow.ts` + `router/errors.ts` as needed.
  - [x] Lot gate: see Lot 1 (full suites green).
- [x] **Lot 3 — D3: bind diagnostic to relevant route (TDD red→green)**
  - [x] Red test: empty candidates + unrelated diagnostics → generic no-route, never another account's message.
  - [x] Fix in `route-planner.ts`.
  - [x] Lot gate: mesh 252/252, gateway 116/116, typechecks + lints green.
- [ ] **Lot N — Final validation**
  - [x] Full mesh (253) + gateway (121) suites, typechecks, lints green. Bumps 0.21.2/0.17.1.
  - [x] Astra xhigh review R2: VERDICT OK (R1 KO resolved). Merge authorized by owner on review OK.
  - [ ] Live demo (scratch): short Claude→gateway→Codex + error preservation (owner GO needed for live calls).
  - [ ] Push, PR, CI green — publish only on owner GO.
