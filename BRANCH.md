# Feature: chat-ui assistantLayout flag (bubble | plain) — full-width assistant opt-in

## Objective
Add an opt-in `assistantLayout: 'bubble' | 'plain'` prop to `@sentropic/chat-ui` so consumers can render assistant responses full-width (Claude/ChatGPT/Gemini style) while user messages stay right-aligned bubbles. Default `bubble` preserves the current sentropic look exactly (zero visual change). Comments/multi-speaker mode is unaffected (always bubbles). Backed by the Opus+Codex double consensus (2026-07-05).

## Scope / Guardrails
- Scope limited to `packages/chat-ui/**`.
- Additive minor (0.23.0 -> 0.24.0); default preserves current rendering — no host change, no sentropic visual regression.
- `plain` mode is a NEW visual look the owner has not seen rendered: this PR ships the capability behind a default-off flag; adopting it in sentropic is a separate, owner-validated decision.
- Make-only workflow; branch worktree `tmp/chatui-followups`; ENV=test-followups (API 9525 / UI 5625 / MAILDEV 1525).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `packages/chat-ui/**`
  - `BRANCH.md`
- **Forbidden Paths**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`, `ui/**`, `e2e/**`, other `packages/*`
- **Conditional Paths**:
  - `.github/workflows/**` (not touched)

## Feedback Loop
- `attention` — `plain` layout is a deliberate new look; owner visual validation required before any consumer (sentropic/DS demo) opts in. Default stays `bubble`.

## AI Flaky tests
- None expected (no LLM/network in the added tests).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: single additive prop in one package, one test cycle.

## UAT Management (in orchestration context)
- Module-only, default-off: no sentropic UAT needed for the default path. `plain` mode preview provided for the owner to evaluate opt-in.

## Plan / Todo (lot-based)
- [x] **Lot 1 — assistantLayout flag**
  - [x] `StreamMessage.svelte`: `plainSurface` prop drops card chrome (border/bg/px) on the chat final-content surface.
  - [x] `ChatPanelShell.svelte`: `assistantLayout` prop (default `bubble`) — full-width wrapper + `plainSurface` wiring for `plain`.
  - [x] `*.svelte.d.ts` updated (ChatPanelShell + StreamMessage).
  - [x] Regenerate theme css (drift guard) for new utility classes.
  - [x] Minor bump 0.23.0 -> 0.24.0 + version-pin tests + export-manifest.
  - [x] DOM tests: default keeps bubble (card + 85%), `plain` renders full-width with no card.
  - [x] Lot gate: `make typecheck-chat-ui` + `make test-chat-ui` (827) + `make test-chat-ui-dom` (157) green.

## Deferred
- Spacing polish (assistant->user, user->next) — separate branch, changes default screenshots, needs owner UAT.
