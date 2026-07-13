# Feature: chat placement controller (L1 core) — headless surface placement state machine

## Objective
Implement the framework-neutral **placement-intent controller** for the chat surfaces system (SPEC_EVOL_CHAT_SURFACES, D1/D2/D3/D6/D13): the pure state machine that owns placement intent, capability negotiation, and the async prepare/commit transition protocol. Non-DS-gated (the DS Drawer/DropZone is L2). DS co-review ENDORSED the boundary (2026-07-13): DS owns only presentational visuals; requestPlacement / DnD hit-testing / occupancy / reparenting stay here.

## Scope / Guardrails
- Scope: `packages/chat-ui/src/state/chatPlacement.ts` + tests. No Svelte/DOM in the module (framework-neutral, React/Angular/Vue-ready).
- This branch = L1 CORE only (the headless controller). Host wiring, "Move to…" menu, chatWidgetLayout migration, and DS components are later slices/lots.
- Make-only; worktree tmp/chat-placement; ENV=test-placement (API 9535 / UI 5635 / MAILDEV 1535).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `packages/chat-ui/src/state/chatPlacement.ts`, `packages/chat-ui/tests/chat-placement.test.ts`, `packages/chat-ui/package.json`, `packages/chat-ui/export-manifest.json`, `BRANCH.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `api/**`, `ui/**`, `e2e/**`, other `packages/*`
- **Conditional Paths**: none

## Feedback Loop
- `clarification` — DS co-review (sent-tech-design-system#32) ENDORSE-with-conditions; boundary confirmed unchanged; 5 L2-shaping conditions fold into D10 (DS-owned visuals). D13 verbatim sent for their final cross-check.

## AI Flaky tests
- None (pure logic).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**

## UAT Management (in orchestration context)
- Module-only, no app surface yet — no UAT this branch. Consumed by later L1 host-wiring slice.

## Plan / Todo (lot-based)
- [x] **L1a — headless placement controller**
  - [x] `chatPlacement.ts`: taxonomy + canonical IDs (D2), HostSurfaces (D3), controller with async prepare/commit protocol (D13), capability negotiation (supported vs available), fallback-chain redirect, intent persistence + monotonic supersession (D6).
  - [x] `chat-placement.test.ts`: id round-trip/normalization/malformed, capability intersection, applied/redirected/rejected/failed/superseded, intent-persisted-immediately, seed-from-supported, subscribe/unsubscribe.
  - [x] Gate: `make typecheck-chat-ui` + `make test-chat-ui` (840) green.
- [x] **L1b — exports + minor bump** — ./state/chatPlacement exported (package.json + export-manifest), chat-ui 0.24.1→0.25.0, version-pin tests bumped. Codex 5.5-xhigh CODE review reconciled (supersede-before-resolve, commit try/catch, notify reentrancy/isolation, monotonic env, guards; +8 hardening tests). 850 green.
- [ ] **L1c — host wiring**: "Move to…" menu, chatWidgetLayout migration (floating|docked → floating.right + drawer.right.primary).
