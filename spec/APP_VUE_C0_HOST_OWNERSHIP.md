# C0: application host ownership ledger

Source pin: `c40b8d1b56372fe1f2e8063ea6069e403dfe4942`. Inclusive ranges partition every line, including imports, types, comments and whitespace. Ownership is the destination of the responsibility, not an instruction to copy source text. A `package` row may already delegate its algorithm to chat-core; keep that single implementation. A `host` row passes data and callbacks to the package; it must not acquire a second rendering implementation.

Source keys: A = `ui/src/lib/components/chat/AppChatPanel.svelte` (3,478); W = `ui/src/lib/components/ChatWidget.svelte` (3,429); S = `ui/src/lib/components/StreamMessage.svelte` (87); P = `ui/src/lib/components/ChatPanel.svelte` (58). Total: **7,052**. Read the behavioural comparisons in [the audit](APP_VUE_C0_AUDIT.md) and primitive mappings in [the DS ledger](APP_VUE_C0_DS_MAPPING.md). Package destinations refer to the existing approved lots, not additional lots.

| Source | First | Last | Owner | Destination | Responsibility and preservation witness |
|---|---|---|---|---|---|
| A | 1 | 184 | host | A8a | Import assembly, authenticated transports, context/checkpoint/document/comment adapters, i18n and domain icons; no app import in chat-ui. |
| A | 185 | 328 | package | C2b | Session/message/history/runtime/prompt value shapes; stable sequence/subsequence ordering and permission presentation types. |
| A | 329 | 340 | host | A8a | Instantiate chat-core controller and inject transport; never recreate its projection/local-tool algorithms. |
| A | 341 | 377 | host | A8a | Domain icon lookup, context host/store lookup and neutral context-module subscription. |
| A | 378 | 434 | host | A8a | Public bindings, workspace rescope generation, controller snapshots and adapter state; retain session/draft/comment binding directions. |
| A | 435 | 499 | package | C2b | Active assistant selection, in-flight/steer state and primary action; preserve attachment-only send and controller-derived status. |
| A | 500 | 546 | host | A8a | ApiError-specific local-tool result retry: 12 attempts, pending-call race only, 150 ms multiplied by attempt. |
| A | 547 | 603 | package | C2b | Permission action delegation and labelled operation/command/path/scope rows; inject labels and command callback. |
| A | 604 | 673 | host | A8a | Adapter-owned document/Drive/checkpoint subscriptions and render/controller state wiring. |
| A | 674 | 695 | host | A8a | Thin projection delegation to the existing chat-core controller. |
| A | 696 | 754 | host | A8a | Full-history transport and lazy runtime-detail loading; deduplicate concurrent loads, feed controller and file-card adapter. |
| A | 755 | 787 | package | C2b | External/input draft synchronisation through existing chatDraft helper; preserve direction and last-applied guard. |
| A | 788 | 980 | host | A8a | Route context, domain tool catalogue, extension/code-workspace runtime detection and allowed-tool policy. |
| A | 981 | 1074 | host | A8a | Context/tool preferences, restricted defaults and Chrome/VS Code visibility policy. |
| A | 1075 | 1126 | host | A8a | Chrome active-tab context RPC, URL/origin/title validation and unavailable-runtime clearing. |
| A | 1127 | 1206 | host | A8a | Persist tool defaults, route/context activation, domain enabled-tool calculation and preference updates. |
| A | 1207 | 1240 | package | C2b | Follow-bottom threshold 96 px, coalesced animation-frame scroll and transient error presentation. |
| A | 1241 | 1274 | package | C2a | Enter versus Shift+Enter and composer sizing; adapt through the DS editor contract, retain focus semantics. |
| A | 1275 | 1342 | host | A8a | Comment runtime construction; workspace-scoped session documents; Drive connection/settings; lazy session creation and document host. |
| A | 1343 | 1394 | package | C2b | Attachment preview URL creation/revocation and existing reducer wiring; revoke on remove, clear and disposal. |
| A | 1395 | 1424 | host | A8a | Scoped download URL resolution and deletion of uploaded context documents when removing a pending attachment. |
| A | 1425 | 1433 | package | C4 | Lightbox open/close state; ignore empty image source. |
| A | 1434 | 1612 | host | A8a | Image/file upload and paste orchestration, Drive picker/config/import, pending/ready/failed drafts and scoped document reload. |
| A | 1613 | 1694 | package | C2b | Edit/cancel/trim validation; controller edit then retry; truncate timeline at user message and retain model/poll parameters. |
| A | 1695 | 1725 | host | A8a | Checkpoint indexing, mutation classifier and humanised preview supplied by checkpointHost. |
| A | 1726 | 1743 | host | A8a | Restore transport and silent history reload; busy/error guard. |
| A | 1744 | 1793 | package | C2b | Restore/retry confirmation state and previous-user lookup; cancel of a retry prompt still retries without restore. |
| A | 1794 | 1841 | package | C2b | Copied feedback for 2 s; rich/plain clipboard and existing fallback; failure reported via labels. |
| A | 1842 | 1860 | host | A8a | Exposed focus and end-caret adapter currently queries `.ProseMirror`; replace through A7b's public focus API, never DS-private DOM. |
| A | 1861 | 1880 | package | C2b | Stable bottom positioning after layout across up to four animation frames. |
| A | 1881 | 1883 | host | A8a | App API error formatting. |
| A | 1884 | 1960 | host | A8a | Todo-runtime record/task/status normalisation and merge, primary action dispatch; todo schema remains host domain. |
| A | 1961 | 1977 | host | A8a | Closing a todo via PATCH and error/busy state. |
| A | 1978 | 2014 | package | C2b | Steer text/in-flight/target guards, clear-and-scroll, delegate optimistic acknowledgement and rollback to controller. |
| A | 2015 | 2149 | host | A8a | Generated-file deduplication/adaptation and todo tool-result interpretation; preserve conflict handling and incremental tasks. |
| A | 2150 | 2190 | host | A8a | Session metadata, checkpoints, documents and todo snapshot ingestion into application state. |
| A | 2191 | 2311 | package | C2b | Frame staging, viewport threshold, chronological block merge, stable ordering and scroll-offset preservation. |
| A | 2312 | 2339 | host | A8a | Fetch/create checkpoints; best-effort failure must not block a chat turn. |
| A | 2340 | 2470 | host | A8a | Session list and summary-history NDJSON loading, stale session clearing and generation cancellation. |
| A | 2471 | 2623 | host | A8a | Select session with staged history swap, model selection from last assistant, obsolete hydration rejection and error surface. |
| A | 2624 | 2699 | host | A8a | New/delete/rescope session lifecycle, reset histories/tools/model/documents and refresh sessions after delete. |
| A | 2700 | 2730 | host | A8a | Model catalogue/default preference transport and Gemini smoothing policy; controller owns catalogue validation. |
| A | 2731 | 2864 | host | A8a | Domain send payload: contexts, tools, local definitions, workspace documents; controller send and best-effort checkpoint. |
| A | 2865 | 2894 | package | C2b | Stop and feedback commands, busy guards and labelled error state via injected controller. |
| A | 2895 | 2912 | host | A8a | Session-document key reset when leaving AI mode or clearing session. |
| A | 2913 | 3014 | host | A8a | Mount catalogue/sessions/preferences, local-tool executor, projection stream, document job updates and session-title SSE. |
| A | 3015 | 3042 | package | C2b | Preference-session change guard and open-menu viewport measurement; domain refresh callbacks injected. |
| A | 3043 | 3074 | host | A8a | Workspace change, route change and domain-store hydration refresh. |
| A | 3075 | 3105 | host | A8a | Dispose comment runtime, all stream keys/listeners/timers/controller attachments and pending previews. |
| A | 3106 | 3134 | host | A8a | A7b rich-text comment composer adapter; preserve textbox name, multiline and disabled state. |
| A | 3135 | 3220 | package | C4 | Thread-picker menu: resolved toggle, new/select, empty state, count/author/preview and selected/closed state; labels provided. |
| A | 3221 | 3247 | host | A8a | A7b edit-field adapter with cancel/send callbacks; retain accessible controls. |
| A | 3248 | 3362 | host | A8a | Domain source/context/tool menu; A9 DocumentSourceMenu, C4 context picker and local-tool availability. |
| A | 3363 | 3370 | host | A8a | A7b AI composer value/change adapter. |
| A | 3371 | 3381 | package | C2b | Restore/trash/expand/stop/steer/send glyphs become DS icon data, not host snippet icons. |
| A | 3382 | 3478 | host | A8a | Compose ChatPanelShell props and callbacks; preserve every binding while consuming C2b/C4/A7b/A9 outputs. |
| W | 1 | 101 | host | A8b | Imports of queue/auth/workspace/RPC adapters and package chrome; retain queue monitor as host content. |
| W | 102 | 143 | package | C3 | Session header, list/conversation pager, return focus, announcement and comments state bindings. |
| W | 144 | 245 | host | A8b | Context provider/host mode/handoff and extension configuration schema/defaults; never transfer session credentials into package defaults. |
| W | 246 | 284 | host | A8b | Placement controller keyed by user/host/workspace; inject package placement module and stable scope. |
| W | 285 | 441 | host | A8b | Extension auth/config/tool-permission state, bash rule grammar and runtime capabilities. |
| W | 442 | 464 | host | A8b | Host capabilities and display-mode persistence; extension-only default tabs. |
| W | 465 | 511 | package | C3 | Dock state mirrors, placement ownership, rising-edge pager default and agent rows from injected data. |
| W | 512 | 555 | package | C3 | Config popover available-height measurement; retain resize cleanup and open-state trigger. |
| W | 556 | 643 | host | A8b | Display-mode preference, handoff capture/restore and fingerprinted publication through host channel. |
| W | 644 | 778 | host | A8b | Runtime messages, sidepanel opening, extension settings gate, user projection, instruction patterns and prompt/workspace draft sync. |
| W | 779 | 932 | host | A8b | Extension config normalisation/API client synchronisation and RPC load; never log tokens. |
| W | 933 | 1170 | host | A8b | Save/test server/workspace config, refresh/apply/create/defer workspace mapping and inherited/override prompt draft. |
| W | 1171 | 1371 | host | A8b | Extension auth status, connect/logout/login-page actions and selected-workspace/auth-session synchronisation. |
| W | 1372 | 1520 | host | A8b | Provider readiness, connection test and local-tool permission policy CRUD. |
| W | 1521 | 1598 | host | A8b | Extension reactive auth/onboarding/config gates and workspace draft reset. |
| W | 1599 | 1716 | package | C3 | Placement migration, DnD drop zones, 5 px header grip threshold, interactive-target exclusion, pointer cancel and Escape. |
| W | 1717 | 1813 | package | C3 | Outside click, first focus, Tab trap, Escape and session-menu Escape; preserve docked/mobile conditions. |
| W | 1814 | 1837 | host | A8b | Session label resolution and queue-derived running/failed badge data. |
| W | 1838 | 1985 | host | A8b | Route/section-to-comment mapping, section label catalogue and external comment context overrides. |
| W | 1986 | 2025 | host | A8b | Session selection/new/load across workspace scopes and API response adaptation. |
| W | 2026 | 2052 | host | A8b | Domain job labels and locale-relative timestamps. |
| W | 2053 | 2085 | package | C3 | Pager focus/announcement and entry selection with injected session callback. |
| W | 2086 | 2131 | host | A8b | Agent action dispatch to job retry/cancel/delete; job SSE feeds permanent bubble badge. |
| W | 2132 | 2188 | host | A8b | Mount extension/API config, job feed and external app events; scoped listener lifecycle. |
| W | 2189 | 2241 | package | C3 | Keyboard bubble trigger and external open/close choreography, focus after opening, preserve in-flight local-tool auto-close rule. |
| W | 2242 | 2283 | host | A8b | Sidepanel close notification, purge jobs REST action and host cleanup. |
| W | 2284 | 2330 | host | A8b | App bubble auth/job visual status and accessible open/close semantics on DS icon-button/badge. |
| W | 2331 | 2346 | package | C3 | Header drag surface and placement menu, delegated event constraints apply. |
| W | 2347 | 3113 | host | A8b | Extension settings UI: server/auth/workspace/prompts/instruction patterns/provider readiness/tool policy; DS form composites with host callbacks. |
| W | 3114 | 3156 | host | A8b | QueueMonitor and comment ChatPanel host slots. |
| W | 3157 | 3237 | package | C3 | Agents list scope header, sessions menu/new/delete confirmation and DS glyphs. |
| W | 3238 | 3277 | host | A8b | Host title/session command binding and ChatPanel composition. |
| W | 3278 | 3360 | host | A8b | Extension authentication/workspace onboarding gates and configured-provider readiness UI. |
| W | 3361 | 3397 | host | A8b | Package widget content slots, agent data and domain queue/comment/session callbacks. |
| W | 3398 | 3429 | host | A8b | ChatDock bindings, host-mode props and package-owned drop-zone view; root dock offset remains A0b. |
| S | 1 | 87 | host | A9 | StreamHub and i18n adapter; preserve every public option/callback for queue and four route consumers. |
| P | 1 | 58 | host | A8a | Session/draft/comment bindings and exposed focus/select/new/delete forwards into AppChatPanel, inside package shell slot. |

Every row has exactly one owner. Mixed host composition ranges assign adapter wiring to `host`; reusable algorithms and default views are assigned separately. Browser APIs do not by themselves justify app ownership: generic scroll, preview URL and clipboard lifecycles belong to the package composition, with injected transports/labels. Endpoint schemas, scopes, credentials, resource IDs and extension RPC remain host concerns.
