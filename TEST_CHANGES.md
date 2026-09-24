# Test change register — L-C-shell

- STRENGTHEN required 2/4 `packages/chat-ui/tests/chat-widget-assembly.dom.spec.ts`: assert exact composer identity, connection, count, draft, mount count and zero disposals immediately after each Jobs, Comments, Chat, list, conversation and plugin transition. Retain all existing assertions; add nonempty row rendering and redundant-landmark regression guards.
- STRENGTHEN required 2 `packages/chat-ui/tests/chat-widget-pager.dom.spec.ts`: replace empty rows with a real session and assert option/title presence, destruction and remount; all prior lifecycle assertions retained. Exact prop/callback forwarding is covered through the full production path above.

- ADD required 2 `packages/chat-ui/tests/chat-widget-production-list.dom.spec.ts`: compile the app's actual PackageChatWidget invocation with two rows and execute real ChatWidget → Pager → AgentsList/DS components. Assert row count/titles, translated labels, formatter arguments/output, activeId updates and remount forwarding; rendered selection and action produce exactly one call with exact arguments (action does not select). App adapter projection and handler effects are outside this wiring test; their existing source/unit guards remain unchanged.

- REGISTER required 5 `packages/chat-ui/chat-ui-reference-validation.json` changes from baseline: (1) AgentsList consumer moves from app to package ChatWidgetPager, evidenced by production-list DOM composition; (2) new ChatWidgetTabBar primitive, evidenced by tab-bar DOM order/selection/suppression and assembly slot ordering; (3) ChatWidget primitive → assembly, evidenced by production-list, production-gate and assembly DOM suites; (4) new ChatWidgetPager assembly, evidenced by pager lifecycle and production-list forwarding. These replace source-only ownership evidence with composed runtime checks, while host startup, real ChatPanel/network effects and browser geometry remain outside the DOM harness. No new JSON edits in this fix pass.

- ADD required 3 `packages/chat-ui/tests/chat-widget-production-gate.dom.spec.ts`: execute production loading/auth/onboarding precedence, settings mousedown/click and stopPropagation, create/defer exact zero-argument calls, use-existing state writes, workspace availability, all busy controls and error rendering. Exercise ready to/from every gate plus blockChatPanel with exact mount/disposal counts. Host derivation and action side effects remain mocked as described below; no E2E changed.

- ADD required 2/3 harness infrastructure: `tests/fixtures/production-widget-snippets.ts`, `ProductionWidgetHarness.svelte`, `ProductionChatPanelMock.svelte` and `vitest.dom.config.ts` compile the app's current dock call, content gate and body snippets verbatim. No copied gate logic; missing snippets fail compilation. Host state/callbacks/translations and ChatPanel side effects are doubles. This executes production markup/wiring, not app startup, store derivation, network effects, real ChatPanel or browser extension bridges; those remain CI/UAT limits. The existing handwritten gate fixture and source guards remain supplementary coverage.

- FIX required 1 `ui/tests/components/chat/ChatWidget-agents-list.test.ts`: extract the whitespace-preceded `class` attribute from the actual conditional section opening tag, split on whitespace, and require the exact `chat-agents-view-slide-from-inline-start` token. Missing, CSS-only, unrelated-node, `data-class`, and prefixed/suffixed token occurrences cannot satisfy it. Conditional mounting, ordering and negative transition assertions remain unchanged.

- FIX `ui/tests/components/chat/ChatWidget-tab-bar.test.ts`: correct the new single-bar regexp from a literal backslash-b to a word boundary. The exact count-one assertion remains; the first full UI run exposed this test-authoring error (488 passed, 1 failed).

- ADD `ui/tests/components/chat/ChatWidget-content-gate.test.ts`: verify ordered loading/auth/workspace/ready branches, one ready call, settings mouse/click actions, create/use-existing/defer controls, busy/error state and blockChatPanel fence. Complements gate DOM tests; does not claim browser onboarding coverage.

- ADD assertions to `packages/chat-ui/tests/export-surface.spec.ts`: runtime/declaration/snapshot agreement for widget header/gate and every pager prop, using the existing anchored contract table; no existing contracts changed.
- ADD assertions to `packages/chat-ui/tests/chat-widget-boundary.test.ts`: widget override absent from source/type/snapshot, separate ChatPanel override retained, package composition and unclipped routing. Existing queue/API/i18n boundary assertions unchanged.

- ADD `packages/chat-ui/tests/chat-widget-assembly.dom.spec.ts` and `tests/fixtures/ChatWidgetGateHarness.svelte`: exercise the final package assembly, all routes, plugin comments suppression, single bar/composer, persistent draft, slot ordering, unclipped header and gate transitions. Fixture supplies only host gate states; actual package routing/pager execute. Mount/dispose counters prove ready is not duplicated.

Every entry requires independent astra-xhigh review. No timeout, skip or E2E assertion changes are authorized.

- CHANGE `ui/tests/components/chat/ChatWidget-{header-snippets,content-snippets,conversation-seams}.test.ts`: replace temporary in-place renders with explicit package slot arguments; chat body replaces temporary chat wrapper. Existing controls, QueueMonitor, sessions menu/icons, Back and ref assertions remain; mounted composition is covered by assembly/pager DOM tests.
- CHANGE `ui/tests/components/chat/ChatWidget-tab-bar.test.ts`: verify package ChatWidget imports/mounts exactly one TabBar; app passes variant, badge, plugin and selection props. Raw-button exclusion remains. DOM suite retains order, selection and extension classes.
- CHANGE `ui/tests/components/chat/ChatWidget-wrapper.test.ts`: reject takeover instead of requiring it; require every host slot and package composition. Existing label/count/purge wiring remains.
- CHANGE `ui/tests/components/chat/ChatWidget-shell-state.test.ts`: move queue routing assertion to package and reject app duplication; tab coercion, badges, auto-close and new-session assertions remain.
- CHANGE `ui/tests/components/chat/ChatWidget-agents-list.test.ts`: point lifecycle/motion/list-container assertions to the package pager; verify app data/callback object syntax and package injection instead of direct AgentsList. Preserve adapter, open-edge default, focus, Back and all-workspaces assertions. DOM lifecycle test additionally checks identity/draft/mount count.

| File | Hunk summary | Why | Behavior retained or added |
| --- | --- | --- | --- |
| packages/chat-ui/tests/chat-widget-tab-bar.dom.spec.ts | S1 import in f1a844e76 | Port audited primitive coverage | Order, selection, comments suppression, extension classes and badge policy |
| packages/chat-ui/tests/chat-widget-header-frame.dom.spec.ts | S2 import in f1a844e76 | Port audited header coverage | Default purge, slot order, override purge and pointer handling |
| ui/tests/components/chat/ChatWidget-tab-bar.test.ts | S1 import in 127f48a5f | Port temporary app wiring checks | Labels, plugin suppression, selection and no raw duplicated tabs |
| ui/tests/components/chat/ChatWidget-header-snippets.test.ts | S2 import in 127f48a5f | Port temporary snippet checks | Leading/action controls and app callbacks |
| ui/tests/components/chat/ChatWidget-content-snippets.test.ts | S3 import in 127f48a5f | Port temporary panel checks | Host QueueMonitor, comments and chat controls |
| ui/tests/components/chat/ChatWidget-conversation-seams.test.ts | S4 import in 127f48a5f | Port temporary conversation checks | Sessions menu, icons, Back and chatPanelRef binding |
| packages/chat-ui/tests/chat-conversation.spec.ts | Version literal updated by port | Align package 0.34.0 | Version agreement; all runtime assertions retained |
| packages/chat-ui/tests/chat-core-host.spec.ts | Version literal updated by port | Align package 0.34.0 | Version agreement; all host assertions retained |
| packages/chat-ui/tests/documents-module.spec.ts | Version literal updated by port | Align package 0.34.0 | Version agreement; all document assertions retained |
| packages/chat-ui/tests/chat-widget-pager.dom.spec.ts | Add lifecycle test | Prove S5 hybrid mounting in DOM | List destruction/remount, eligibility, persistent conversation identity/draft, one header/body, live announcements, one subscription |
| packages/chat-ui/tests/chat-widget-header-frame.dom.spec.ts | Replace data-header-grip expectation with data-chat-header-grip; add cursor assertions | Restore app contract without changing E2E selector | Pointer callback and dragging attribute retained; cursor parity added |
