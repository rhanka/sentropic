# Feature: llm-gw relay chain Lot 1 — workstation stage (Claude + Muse, default-off)

## Objective
Implement Lot 1 (sub-lots L1.1 through L1.4) of `spec/SPEC_EVOL_LLM_GW_RELAY_CHAIN.md` (r3) for the workstation stage (Claude + Muse only, default-off).

## Scope / Guardrails
- Worktree `tmp/gw-relay-l1` on branch `feat/gw-relay-l1`, isolated `ENV=test-gw-l1` (`API_PORT=9192 UI_PORT=5392 MAILDEV_UI_PORT=1292`).
- Make-only workflow, `ENV=test-gw-l1` always last.
- Everything new OFF by default (`captureEnabled: false`, `enableLoopbackHttpSessionMint: false`).
- All code, comments, commits and PR text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-gateway/src/guards/**`
  - `packages/llm-gateway/src/ports/**`
  - `packages/llm-gateway/src/redaction.ts`
  - `packages/llm-gateway/tests/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `.github/workflows/**`
  - `docker-compose*.yml`
  - `deploy/**`
  - `.cursor/rules/**`
  - `rules/**`
  - `package-lock.json`
  - `packages/llm-mesh/**`
  - `packages/cluster-mesh/**`
  - `api/**`
  - `apps/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`

## Feedback Loop
- None.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: Single sequential Lot 1 sub-lot chain in one isolated worktree.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `.tmp/packets/COMMON-RULES.md`, and `spec/SPEC_EVOL_LLM_GW_RELAY_CHAIN.md` r3.
  - [x] Create isolated worktree `tmp/gw-relay-l1` on branch `feat/gw-relay-l1`.
  - [x] Verify `harness check branch` passes (`PASS C1`).

- [x] **Lot 1.1 — control.sock-first session mint, default-OFF loopback bootstrap proof & rate limiter**
  - [x] Red: `packages/llm-gateway/tests/bootstrap-session-mint.test.ts`
  - [x] Green: `packages/llm-gateway/src/node/bootstrap-session-mint.ts`, `src/node/host-types.ts`, `src/node/http-server.ts`, `src/node/gateway-host.ts`
  - [x] Gate: `make test-llm-gateway SCOPE=tests/bootstrap-session-mint.test.ts ENV=test-gw-l1`, `typecheck-llm-gateway`, `lint-llm-gateway`, `scope-check`

- [x] **Lot 1.2 — StageRewriteEngine & cache-marker preservation for Claude + Muse**
  - [x] Red: `packages/llm-gateway/tests/stage-rewrite.test.ts`
  - [x] Green: `packages/llm-gateway/src/rewrite/stage-rewrite.ts`, `canonical-ingress.ts`, `canonical-egress.ts`, `route-flow-core.ts`, `node/gateway-host.ts`, `ports/gateway-state.ts`
  - [x] Gate: `stage-rewrite.test.ts`, `muse.test.ts`, `typecheck-llm-gateway`, `lint-llm-gateway`, `check-llm-model-equivalences`, `scope-check`

- [x] **Lot 1.3a — Pure GuardEngine & typed GuardPort contract**
  - [x] Red: `packages/llm-gateway/tests/guard-engine.test.ts`
  - [x] Green: `packages/llm-gateway/src/ports/guards.ts`, `src/guards/guard-engine.ts`, `src/redaction.ts`
  - [x] Gate: `guard-engine.test.ts`, `typecheck-llm-gateway`, `lint-llm-gateway`, `scope-check`

- [ ] **Lot 1.3b — Streaming SSE overlap scanner & router flow wiring**
  - [ ] Red: `packages/llm-gateway/tests/guard-stream-flow.test.ts`
  - [ ] Green: `packages/llm-gateway/src/guards/sse-guard-tee.ts`, flow/router wiring
  - [ ] Gate: `guard-stream-flow.test.ts`, `typecheck-llm-gateway`, `lint-llm-gateway`, `scope-check`

- [ ] **Lot 1.4 — Workstation FileCaptureVault (default-OFF) & version bump**
  - [ ] Red: `packages/llm-gateway/tests/file-capture-vault.test.ts`
  - [ ] Green: `packages/llm-gateway/src/ports/capture-vault.ts`, `src/node/file-capture-vault.ts`, `control-server.ts`, `control-client.ts`, exports
  - [ ] Gate: full `test-llm-gateway`, `typecheck-llm-gateway`, `lint-llm-gateway`, `pack-llm-gateway`, `scope-check`
