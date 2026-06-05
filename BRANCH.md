# Feature: ChatDock — extract sentropic's gold dock shell as a canonical reusable surface

## Objective
Extract the GENERIC dock surface from sentropic's real dock shell (`ui/src/lib/components/ChatWidget.svelte`, ~3284 lines, gold) into a canonical `@sentropic/chat-ui` `ChatDock` component, and make sentropic's `ChatWidget` consume it with ZERO UX change. This is the "missing-link" surface requested by diag (and mermaid's "layout docked"): reusers should INHERIT the dock, not reconstruct it. See `spec/SPEC_EVOL_CHATUI_FIDELITY.md` §10/§11. Fidelity rule: canonical only if sentropic consumes it identically.

## Scope / Guardrails
- Make-only; ENV last; worktree `tmp/chatui-dock`; never `ENV=dev`; never `make clean-all`.
- Extract the GENERIC dock surface ONLY; keep app/extension-specific behaviour app-side (injected). ZERO UX change for sentropic.
- All text English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `packages/chat-ui/src/components/ChatDock.svelte` (+ `.d.ts`) NEW
  - `packages/chat-ui/src/state/*` (only a small dock-state helper if genuinely shared; prefer reusing `state/chatWidgetShell` + `stores/chatWidgetLayout` which already exist)
  - `packages/chat-ui/package.json` (export + version bump 0.12.1 → 0.13.0 minor)
  - `packages/chat-ui/export-manifest.json` (_version + new export)
  - `packages/chat-ui/chat-ui-reference-validation.json` (ChatDock = primitive dogfooded by ui/.../ChatWidget.svelte)
  - `packages/chat-ui/tests/chat-dock.dom.spec.ts` (NEW — dock behaviour: modes, open/close, slot)
  - `ui/src/lib/components/ChatWidget.svelte` (consume ChatDock; keep app/extension specifics here, injected)
  - `BRANCH.md`
- **Forbidden**: `api/**`, `Makefile`, `docker-compose*.yml`, `.github/**`, `.cursor/**`, other `ui/**`.

## Feedback Loop
- none (ESCALATE per below)

## Orchestration Mode
- [x] Mono-branch + cherry-pick

## Plan / Todo
- [x] **Lot 0 — Map the boundary (READ the 3284-line gold; decide generic vs app-specific)**
  - [x] Worktree `tmp/chatui-dock` on `feat/chatui-dock`; ENV `feat-chatui-dock`; ports API 9325 UI 5425 MAILDEV 1325.
  - [x] Read `ui/src/lib/components/ChatWidget.svelte` and classify its concerns:
    - **GENERIC dock surface (extract → ChatDock)**: `displayMode` docked/floating, `dockWidthCss` + resize handle, open/close, mobile bottom-sheet (mediaquery + scroll-lock), the layout publication to `chatWidgetLayout`, and a **slot** for the chat content (what gets mounted inside).
    - **APP/EXTENSION-specific (STAYS in ui ChatWidget, injected into ChatDock via props/events/slots)**: extension runtime detection, sidepanel/overlay host modes, `sentropic:open-chat`/open-sidepanel/open-overlay events, session handoff (`ChatWidgetHandoffState`), workspace/contextProvider, what is actually mounted (AppChatPanel).
  - [x] Reuse existing `@sentropic/chat-ui/state/chatWidgetShell` + `stores/chatWidgetLayout` (already published) for dock state where possible — don't duplicate.

- [x] **Lot 1 — ChatDock component + sentropic consumes (ZERO UX change)**
  - [x] Create `ChatDock.svelte`: props for `mode` (docked/floating) + `dockWidthCss`/resize + `open`/`onClose` + mobile-sheet behaviour; a default slot for the mounted chat; emit/forward resize+layout to `chatWidgetLayout`. Host-specific bits are PROPS/slots, not baked in.
  - [x] `ui/src/lib/components/ChatWidget.svelte` consumes `<ChatDock>` for the dock chrome, passing its app/extension specifics + mounting AppChatPanel in the slot. The rendered DOM/behaviour must be IDENTICAL (zero UX change) — verify by diff + the existing chat e2e (group 03) covering the widget.
  - [x] Export `./components/ChatDock.svelte`; bump 0.12.1 → 0.13.0; update export-manifest + manifest (ChatDock = primitive dogfooded by ui ChatWidget).
  - [x] DOM test `tests/chat-dock.dom.spec.ts`: assert modes (docked width vs floating), open/close, slot renders, mobile-sheet class — the dock contract.

- [x] **Lot N — Gate**
  - [x] `make typecheck-chat-ui ENV=feat-chatui-dock` PASS, `make build-chat-ui ENV=feat-chatui-dock` PASS, `make pack-chat-ui ENV=feat-chatui-dock` PASS, `make test-chat-ui ENV=test-chatui-dock` PASS (79/79), `make test-chat-ui-dom ENV=test-chatui-dock` PASS (133/133), `make typecheck-ui` PASS (0 errors), `make lint-ui` PASS (0 errors), `make build-ui ENV=feat-chatui-dock` PASS, `make build-ui-image ENV=feat-chatui-dock` PASS. `make down` DONE. e2e (chat group 03) via PR CI — it validates the dock didn't regress.
  - [ ] PR (BRANCH.md body), CI green (rerun e2e flakes). On merge publishes 0.13.0. Remove BRANCH.md, push, merge.

## ESCALATE (don't thrash) — a clean stop here is a CO-DESIGN finding for diag, not a failure
If the generic dock surface CANNOT be cleanly separated from the app/extension coupling (e.g. the docked/floating logic is entangled with extension-runtime or session-handoff such that extracting it would change sentropic's behaviour or require a sprawling prop/event surface), STOP and report: (a) exactly which concerns are entangled, (b) a proposed minimal ChatDock contract (the cleanly-extractable subset) vs what must stay app-side, (c) what diag's PR should target. Do NOT force a leaky extraction or change sentropic's UX.
