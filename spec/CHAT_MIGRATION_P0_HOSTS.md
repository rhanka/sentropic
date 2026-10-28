# P0 — Hosts, siblings, scaffolds and deletion handoff

Date: 2026-10-28. [Contract](CHAT_MIGRATION_P0.md); [complete tracked sending-tree matches](CHAT_MIGRATION_P0_CONSUMERS.md). H retains the integration, R imports move to Sentropic `chat-runtime` in P1, V imports remain chat-ui and later consume the DS release. Historical documentation and append-only Track events are evidence, never rewrite/delete candidates.

## Sending hosts and indirect consumers

| Consumer family | Paths / entry surfaces | Owner / migration |
| --- | --- | --- |
| Global app dialogue | `ui/src/routes/+layout.svelte` → `ChatWidget.svelte` → `ChatPanel.svelte` → `chat/AppChatPanel.svelte` | H/APP lifetime/selection/adapters; V package shell and Conversation; R imports hoisted to runtime in P1/P2. Remove repeated composer/timeline/loop, not the adapter responsibility. |
| Shared stream renderer | App `StreamMessage.svelte` wrapper → folders, folder detail, initiative detail, organizations and QueueMonitor surfaces | H/APP domain/citation actions; V canonical StreamMessage; R event normalization moves. Keep one renderer and qualify every indirect mount in P5. |
| Stream subscribers | `ui/src/lib/stores/streamHub.ts`, matrix, DocumentsBlock, WorkspaceSettingsPanel and queue consumers | H host endpoints/auth and subscriptions; R streamHub transport/types. Do not break non-chat consumers by changing package exports. |
| Layout-store users | Header, Toast and +layout, plus extension layout/handoff adapters | H application geometry and persistence; V pure layout intent/store contract. Split injected storage if physical implementation still couples them; no hidden runtime/DS-store cycle. |
| Web adapters | `ui/src/lib/chat/{web-host-adapter,chat-core-host-adapter,context-adapter,documentHostAdapter,comment-adapter,comment-host-adapter,agents-feed-adapter,tool-scope-adapter}.ts`, `ui/src/lib/adapters/checkpointHostAdapter.ts` | H/APP domain adapters stay; R imports/types migrate; V imports only normalized view contracts. |
| Chrome | `ui/src/lib/upstream/chrome-host-adapter.ts`, shared app Widget/Panel, Chrome injected-script/runtime via bridge | H/Chrome maintainer owns overlay/sidepanel/auth/permissions/platform executor and qualification; migrate R exports without widening capability. Build artifact `ui/chrome-ext/dist`. |
| VSCode | `ui/vscode-ext/webview-entry.ts`, `local-tools-adapter.ts`, shared app hosts and native bridge | H/VSCode maintainer owns runtime adapter/auth/commands/theme; R exports migrate. Current supported behavior is required; new cross-process L0d/L4 remains its follow-on lane. |
| Cowork desktop | `packages/cowork-desktop/src/runner/cowork-runner.ts` imports pending-tool parser; package.json and packaging entry/esbuild config bundle source | H/cowork owner; parser moves to R, independent runtime dependency. Update packaging references and Windows packaging assumptions; no visual source bundled after M3. |
| Cowork bridge | `packages/cowork-bridge/package.json` peers on chat-ui; public index/README recommend its streamHub | H/cowork owner; update runtime recommendation/peer as needed, preserve handoff protocol. L-A′ union changes use explicit separate lane hand-over. |
| cited-source-viewer | README/index compare chat-ui publication conventions; no app citation activation established | H existing package owner; historical/reference links only. F11 remains parked; no speculative implementation or transfer. |
| App-foundry/scaffolds | Historical `plan/42a-BRANCH_feat-build-app-cli.md`, `SPEC_EVOL_BUILD_APP_CLI.md` and report refer to generated chat embeds | H foundry/CLI owner; current sending baseline has no build-app CLI/template implementation package or generated-template chat import match. Notify owner and require its current generator/clean-generated-app fixture at P1/P5; do not treat historical plan as a live consumer or recreate absent sources. |

The complete direct match inventory includes unit/source/DOM tests, both locks, pipeline/source hashing and publication files. It also contains graph caches, Track and qualification lock snapshots: immutable historical evidence stays historical. Their presence must not trigger a blind global replacement. API private imports of chat-core/chat-server are retained Sentropic concerns (F14) unless they become a visual-tarball dependency, in which case P5 blocks.

## Siblings checked and acknowledgement boundary

| Workspace / checked revision | Actual evidence | Accountable role / acceptance |
| --- | --- | --- |
| `radar-immobilier` / `43c873e0d2cf7acd50e330130fb809c7bf808953` | Tracked matches: AGENTS.md, README.md, package-lock.json, ui/package.json, ui/src/App.svelte, ui/src/lib/backlog/backlog-data.ts, ui/src/lib/chat/chat-client.ts, chat-context.ts, chat-widget-layout.ts, ui/src/lib/components/RadarChatPanel.svelte, ui/src/lib/components/chat/ChatWidgetHost.svelte. UI declares `chat-ui:^0.5.0`. | H/immo chat integration maintainer; runtime client imports streamHub/streamTypes/model-selection/context, visual Panel imports StreamMessage/ModelSelector/MessageActions/ContextChips/Widget. P1 notice + supported-version migration manifest; P5 installed-artifact fixture. Existing ^0.5 range does not imply accepting the new major. |
| `graphify` / `8f19554cea3a4397fd66a90c7e9fd5ea54c81626` | Only source matches in `studio/src/components/AnswerPanel.svelte` and `studio/src/lib/retrieval.js`: comments describe a future chat-ui/renderAnswer seam. | H/graphify consumer owner; prospective consumer, not proven installed adoption. Confirm current embed need/version at P1 entry. |
| Historical `drawing-skills` | No local workspace at the plan's old name; GitHub `rhanka/drawing-skills` lookup returns 404. | Historical requester, current owner routed through graphify/conductor; no current import map or acceptance fabricated. Bounded P1 handoff: confirm renamed/replacement host or record request parked; acceptance is a named current host + installed pair fixture. |
| DS docs/current source / `22421ed82f69737825b962e5a0e448482733eaca` | Consumer paths below; source inspection does not prove published runtime or completed unified dialogue. | H/DS docs maintainer, M1b; exact final pair and owner-U0 freshness required. |

## Receiving DS consumer map

| Paths under DS repository | Classification / accountable owner |
| --- | --- |
| `apps/docs/src/lib/chat/ChatWidget.svelte` | H/DS docs adapter after replacing its independent shell/dialogue with canonical package composition; endpoint/auth/locale/quota remain host. |
| `apps/docs/src/lib/chat/{DocsSearch.svelte,chat-config.ts,docs-search-index.ts,anon-counter.test.ts}` | H/DS docs host/search/quota configuration and tests; retain responsibilities, migrate runtime imports only if introduced. |
| `apps/docs/src/lib/feedback/GraphifyBot.svelte` | H/DS docs feedback adapter; use shared shell/Conversation where dialogue is needed, no second engine. |
| `apps/docs/src/lib/framework/SvelteNode.svelte`, `examples.ts` | V/DS examples/framework integration; migrate demo renderer to canonical primitives/composition. |
| `apps/docs/src/lib/components-catalog.ts`, `apps/docs/src/routes/+layout.svelte` | H/DS docs catalogue/mount wiring; point to canonical released visuals. |
| `apps/docs/src/routes/components/{chat-composer,chat-message,chat-thread,message-status-badge}/+page.svelte` | V/DS primitive demos remain valid on the same canonical components; no forced runtime dependency. |
| `packages/components-svelte/src/lib/{ChatComposer,ChatMessage,ChatThread,MessageStatusBadge,StreamingMessage}.svelte`, `index.ts` | V/DS components; survivor table governs input/message/thread deduplication; status/stream views consume normalized data. |
| `packages/components-svelte/src/{ChatUI,AnatomyTokens}.test.ts` | V/DS visual tests; add parity/ref/focus/anchor qualification without a runtime copy. |
| `packages/components-react/src/{ChatComposer,ChatMessage,ChatThread}.tsx`, `catalog.tsx`, `catalog.test.tsx`, `index.ts`, `index.test.tsx` | V/DS framework parity; retain their framework ports, no Svelte runtime import. |
| `packages/components-vue/src/{ChatComposer,ChatMessage,ChatThread,MessageStatusBadge,StreamingMessage}.ts`, `index.ts`, `behavior.test.ts` | V/DS framework parity; same generic contract, native bindings retained. |
| `packages/components-angular/src/{ChatComposer,ChatMessage,ChatThread,MessageStatusBadge,StreamingMessage}.ts`, `index.ts` | V/DS framework parity; generated tracked `dist/**` counterparts remain DS build outputs, not separate canonical implementations. |

The DS source matches were enumerated across `apps`, `packages` and `examples`; generated Angular declarations/maps/indexes are covered by the same owning sources. M1b names each actual deletion and retained wrapper after implementation. Primitive-only demos stay; only duplicate generic engines/markup/styles are deleted. DS owns all receiving edits.

## Concrete M0/M3 sending deletion candidates (paper only)

| Path / link | Disposition / owner |
| --- | --- |
| `packages/chat-ui/**` after P1 | V → DS only after U0; M3 deletes sending visual source, generated CSS, visual tests/docs/generator and old publish support. **Retain new `packages/chat-runtime/**`** with its tests and publisher. |
| `Makefile` (`UI_VERSION` source hashing and chat-ui build/test/pack/publish/install targets) | H/release owner retires old visual pipeline/source links, preserving runtime targets; requires M3 scope exception with rationale/impact/rollback. |
| `.github/workflows/ci.yml` bootstrap target, chat-ui filters, validate/publish jobs | H/release owner removes sending visual publisher only after authorized single-publisher handover; retain runtime pipeline. Future exception required. |
| `scripts/test-api-image-canonical.sh:155` | H/API build owner replaces visual source-input list with installed dependency evidence; runtime input remains its own canonical package. |
| `scripts/ci/publishable-manifests.mjs`, `publishable-{classification,pack,ci-wiring}.test.mjs` | H/release qualification owner updates active package classifications, recipe/source assertions and artifact manifests for retained runtime/removed visual source; retain the general guard implementations. |
| `ui/package.json:71`, `packages/cowork-desktop/package.json:42` and `package-lock.json`, `ui/package-lock.json` | H/consumer owners replace `file:` visual links with verified registry pair; remove source alias/build packaging assumptions. |
| `ui/src/app.css:5` | P3 removes package source scan under its own bounded exception; preserve visual parity and unrelated app styling. |
| Active docs/scaffolds/source aliases/source-copy steps | H/respective owners audit all tracked references at M3/M4; versioned historical records remain, no executable source fallback. |

Future exceptions document rationale, impact and rollback before touching Makefile/CI/app CSS. Pre-publication rollback reverts an unpublished candidate; afterwards forward-fix or pin a compatible immutable pair, never restore a local visual mirror. `docker-compose*.yml` remains forbidden unless a specific necessary exception is approved in its implementation lane. P0 deletes nothing and changes no consumer behavior.
