# P0 — Complete tests, fixtures and release-support map

Snapshot: Sentropic `ea20bd9c026e9717d911514e763f8911b6981dde` (2026-10-28). See [contract](CHAT_MIGRATION_P0.md).

V = reusable visual (future DS custody); R = Sentropic `chat-runtime`; H = justified host integration. Mixed rows name a required split, never unassigned ownership.

Test names below are relative to `packages/chat-ui/`. R tests stay in Sentropic with runtime; V tests follow visual custody after U0; mixed integration tests remain Sentropic and yield neutral DS fixtures. No tests move in P0.

| Path | Owner / disposition |
| --- | --- |
| `LICENSE` | R+V: Sentropic integration/release + DS visual split |
| `README.md` | R+V: Sentropic integration/release + DS visual split |
| `THEMING.md` | V: DS visual maintainer after U0 |
| `chat-ui-reference-validation.json` | R+V: Sentropic integration/release + DS visual split |
| `export-manifest.json` | V: DS visual maintainer after U0 |
| `package.json` | R+V: Sentropic integration/release + DS visual split |
| `scripts/gen-theme-css.mjs` | V: DS visual maintainer after U0 |
| `scripts/make-publish-pkgjson.mjs` | R+V: Sentropic integration/release + DS visual split |
| `scripts/theme-token-map.mjs` | V: DS visual maintainer after U0 |
| `scripts/verify-publish-artifacts.mjs` | R+V: Sentropic integration/release + DS visual split |
| `svelte.config.js` | R+V: Sentropic integration/release + DS visual split |
| `tests/agents-entry.test.ts` | V: DS visual maintainer after U0 |
| `tests/agents-list-source.test.ts` | V: DS visual maintainer after U0 |
| `tests/agents-list.dom.spec.ts` | V: DS visual maintainer after U0 |
| `tests/agents-sort.test.ts` | V: DS visual maintainer after U0 |
| `tests/agents-view-markers.test.ts` | V: DS visual maintainer after U0 |
| `tests/chat-attachments.test.ts` | R: runtime maintainer; relocate with implementation |
| `tests/chat-composer-boundary.test.ts` | V: DS visual maintainer after U0 |
| `tests/chat-context-picker.dom.spec.ts` | R: runtime maintainer; relocate with implementation |
| `tests/chat-context.spec.ts` | R: runtime maintainer; relocate with implementation |
| `tests/chat-conversation-functional.dom.spec.ts` | R+V: Sentropic integration/release + DS visual split |
| `tests/chat-conversation.dom.spec.ts` | V: DS visual maintainer after U0 |
| `tests/chat-conversation.spec.ts` | V: DS visual maintainer after U0 |
| `tests/chat-core-host.spec.ts` | R: runtime maintainer; relocate with implementation |
| `tests/chat-dock-source.spec.ts` | V: DS visual maintainer after U0 |
| `tests/chat-dock.dom.spec.ts` | V: DS visual maintainer after U0 |
| `tests/chat-draft.test.ts` | R: runtime maintainer; relocate with implementation |
| `tests/chat-loop-controller.spec.ts` | R: runtime maintainer; relocate with implementation |
| `tests/chat-panel-boundary.test.ts` | V: DS visual maintainer after U0 |
| `tests/chat-panel-shell.dom.spec.ts` | V: DS visual maintainer after U0 |
| `tests/chat-placement-classes.test.ts` | V: DS visual maintainer after U0 |
| `tests/chat-placement-dnd.test.ts` | V: DS visual maintainer after U0 |
| `tests/chat-placement-menu-button.dom.spec.ts` | V: DS visual maintainer after U0 |
| `tests/chat-placement-menu.test.ts` | V: DS visual maintainer after U0 |
| `tests/chat-placement-migration.test.ts` | V: DS visual maintainer after U0 |
| `tests/chat-placement.test.ts` | V: DS visual maintainer after U0 |
| `tests/chat-projection.test.ts` | R: runtime maintainer; relocate with implementation |
| `tests/chat-session-hydration.test.ts` | R: runtime maintainer; relocate with implementation |
| `tests/chat-session-runtime.test.ts` | R: runtime maintainer; relocate with implementation |
| `tests/chat-sessions-bar.dom.spec.ts` | R: runtime maintainer; relocate with implementation |
| `tests/chat-timeline-boundary.test.ts` | V: DS visual maintainer after U0 |
| `tests/chat-widget-assembly.dom.spec.ts` | R+V: Sentropic integration/release + DS visual split |
| `tests/chat-widget-boundary.test.ts` | V: DS visual maintainer after U0 |
| `tests/chat-widget-header-frame.dom.spec.ts` | V: DS visual maintainer after U0 |
| `tests/chat-widget-layout.test.ts` | V: DS visual maintainer after U0 |
| `tests/chat-widget-pager.dom.spec.ts` | V: DS visual maintainer after U0 |
| `tests/chat-widget-production-gate.dom.spec.ts` | R+V: Sentropic integration/release + DS visual split |
| `tests/chat-widget-production-list.dom.spec.ts` | R+V: Sentropic integration/release + DS visual split |
| `tests/chat-widget-shell-sessions.test.ts` | V: DS visual maintainer after U0 |
| `tests/chat-widget-tab-bar.dom.spec.ts` | V: DS visual maintainer after U0 |
| `tests/checkpoints.spec.ts` | R: runtime maintainer; relocate with implementation |
| `tests/comments-module.spec.ts` | R+V: Sentropic integration/release + DS visual split |
| `tests/composer-autosize.spec.ts` | V: DS visual maintainer after U0 |
| `tests/composer-wired.dom.spec.ts` | V: DS visual maintainer after U0 |
| `tests/context.spec.ts` | R: runtime maintainer; relocate with implementation |
| `tests/documents-attachment-state.test.ts` | R: runtime maintainer; relocate with implementation |
| `tests/documents-generated-file-cards.test.ts` | R: runtime maintainer; relocate with implementation |
| `tests/documents-module.spec.ts` | R+V: Sentropic integration/release + DS visual split |
| `tests/export-surface.spec.ts` | R+V: Sentropic integration/release + DS visual split |
| `tests/fixtures/ChatWidgetGateHarness.svelte` | V: DS visual maintainer after U0 |
| `tests/fixtures/ProductionChatPanelMock.svelte` | V: DS visual maintainer after U0 |
| `tests/fixtures/ProductionWidgetHarness.svelte` | V: DS visual maintainer after U0 |
| `tests/fixtures/production-widget-snippets.ts` | R+V: Sentropic integration/release + DS visual split |
| `tests/fixtures/streams/reasoning-then-content.ndjson` | V: DS visual maintainer after U0 |
| `tests/fixtures/streams/simple-assistant-response.ndjson` | V: DS visual maintainer after U0 |
| `tests/fixtures/streams/tool-call-and-result.ndjson` | V: DS visual maintainer after U0 |
| `tests/host-adapter-types.test.ts` | R+V: Sentropic integration/release + DS visual split |
| `tests/image-lightbox.dom.spec.ts` | V: DS visual maintainer after U0 |
| `tests/local-tools-store.test.ts` | R: runtime maintainer; relocate with implementation |
| `tests/markdown-refs.spec.ts` | V: DS visual maintainer after U0 |
| `tests/message-actions.dom.spec.ts` | V: DS visual maintainer after U0 |
| `tests/message-actions.spec.ts` | V: DS visual maintainer after U0 |
| `tests/message-attachments.dom.spec.ts` | V: DS visual maintainer after U0 |
| `tests/model-selection.spec.ts` | R: runtime maintainer; relocate with implementation |
| `tests/model-selector.dom.spec.ts` | V: DS visual maintainer after U0 |
| `tests/projection.golden.spec.ts` | R: runtime maintainer; relocate with implementation |
| `tests/reference-validation.spec.ts` | R+V: Sentropic integration/release + DS visual split |
| `tests/renderer-registry.test.ts` | V: DS visual maintainer after U0 |
| `tests/replay.test.ts` | R: runtime maintainer; relocate with implementation |
| `tests/session-list.dom.spec.ts` | V: DS visual maintainer after U0 |
| `tests/session-list.spec.ts` | V: DS visual maintainer after U0 |
| `tests/spike.dom.spec.ts` | V: DS visual maintainer after U0 |
| `tests/stream-history-bounds.test.ts` | R: runtime maintainer; relocate with implementation |
| `tests/stream-message-boundary.test.ts` | V: DS visual maintainer after U0 |
| `tests/stream-message-projection.test.ts` | V: DS visual maintainer after U0 |
| `tests/stream-message-smoothing.test.ts` | V: DS visual maintainer after U0 |
| `tests/stream-throughput.test.ts` | R: runtime maintainer; relocate with implementation |
| `tests/streamHub.test.ts` | R: runtime maintainer; relocate with implementation |
| `tests/theme-css.spec.ts` | V: DS visual maintainer after U0 |
| `tests/transport.test.ts` | R: runtime maintainer; relocate with implementation |
| `tests/web-host.test.ts` | R: runtime maintainer; relocate with implementation |
| `tsconfig.json` | R+V: Sentropic integration/release + DS visual split |
| `vitest-dep-svelte-ts.ts` | R+V: Sentropic integration/release + DS visual split |
| `vitest.dom.config.ts` | R+V: Sentropic integration/release + DS visual split |
