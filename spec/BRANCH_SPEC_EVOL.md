# BRANCH_SPEC_EVOL — chat-ui gold shell extraction (cartography + controller boundary)

Working note for `feat/chatui-gold-shell` (consolidated before tests, deleted at branch close).

## Source anatomy — the gold shell spans TWO app-local components (~7000 lines)
- `ui/src/lib/components/ChatWidget.svelte` (3107 lines; script L1–1960, template L1960–3107): dock chrome on top of module `ChatDock` — tabs (Commentaires/Chat IA/Jobs), **sessions bar** (label L2951–2958, menu/new/delete L2960–3060 incl. inline delete-confirm), jobs badge (already module: `resolveChatWidgetJobBadge`), focus-trap UX, display-mode wiring.
- `ui/src/lib/components/chat/AppChatPanel.svelte` (3931 lines; script L1–3116 ~210 vars, gold template L3118–3899 `.topai-chat-panel-shell`, style L3900–3931): timeline + composer composition.
- Comments concern ALREADY extracted (CommentsPanel + createCommentState); mounted for `mode==='comments'`.
- Existing headless home for widget-chrome state: `packages/chat-ui/src/state/chatWidgetShell.ts` (tabs/badge/visibility pure helpers) → S1a extends it (sessions bar) instead of creating a parallel module.

## Host interface today (stays host-side)
- Props: `sessions`, `contextStore`, `sessionId`, `draft`, `loadingSessions`, `mode: 'ai'|'comments'`, `comment*` (context/section/thread ids + labels), `commentLoading`.
- Exported imperative methods (used by ChatWidget/routes): `focusComposer()`, `selectSession(id)`, `newSession()`, `deleteCurrentSession()`.
- Adapters (ports, remain app-side): chat-core-host, session, context, document(+Host), comment-host, tool-scope, checkpoint-host; app stores (folders/initiatives/organizations/session/workspaceScope/streamHub); app utils (api, docx, comments, documents).

## Already-modular bricks composed by the shell (no re-extraction)
`ModelSelector`, `MessageActions`, `ChatContextPicker`, `CommentsPanel`, documents suite (`AttachmentBand`, `GeneratedFileCardTray`, `ImageLightbox`, `MessageAttachments`), state (`chatLoopController`, `chatProjection`, `chatDraft`, `chatAttachments`, `chat-context`), `localTools`, utils (`model-selection`, `chat-run-projection`, `chat-tool-scope`, `composer-autosize`).

## Extraction contract (headless-first — owner directive: React/Angular/Vue later)
- `packages/chat-ui/src/state/panelShell.ts` — framework-neutral controller (NO Svelte import; svelte/store `Readable/Writable` allowed as the reactive primitive, consistent with existing chat-ui state modules). Owns the orchestration clusters:
  1. sessions bar (list open/select/new/delete, "Aucune conversation" label state)
  2. model selection (catalog wiring, selected provider/model, selector width)
  3. composer (draft, attachments band, primary action send/steer, steer readiness, run-in-flight)
  4. layout (panel el sizing, composer autosize hooks, scroll/auto-scroll)
  5. empty state + timeline projection glue
- `packages/chat-ui/src/components/ChatPanelShell.svelte` — thin view: gold template (L3118–3899) rendering from the controller + slots for host-injected zones (tabs row stays host-side in sentropic's ChatWidget; comments panel slot; document menus).
- `AppChatPanel.svelte` becomes: adapter wiring + `<ChatPanelShell {controller} …>` (thin host wrapper).
- Density: keep today's "petit" values verbatim (preset formalization = Lot A2, separate branch).
- Acceptance: pixel parity vs QA'd gold reference (chat-parity artifact set É1/É2/É3-4).

## Slicing for Lot 1–3 (each slice = atomic commit, gates green)
- S1 controller skeleton + sessions cluster (+ unit tests)
- S2 model-selection cluster (+ tests)
- S3 composer/steer/attachments cluster (+ tests)
- S4 layout/scroll cluster (+ tests)
- S5 ChatPanelShell.svelte view extraction (template move, slot seams)
- S6 AppChatPanel thin-wrapper adoption + full test-ui + parity captures
