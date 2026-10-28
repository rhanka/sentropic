# P0 — Sending-repository consumer and source-link inventory

Snapshot: Sentropic `ea20bd9c026e9717d911514e763f8911b6981dde` (2026-10-28). See [contract](CHAT_MIGRATION_P0.md).

V = reusable visual (future DS custody); R = Sentropic `chat-runtime`; H = justified host integration. Mixed rows name a required split, never unassigned ownership.

Exhaustive tracked matches outside the package/spec/plan at the pinned baseline. All hosts are retained; they migrate R imports in P1 and visual artifacts in M3. Lines in lockfiles are dependency evidence, not runtime imports. Historical records are retained as history.

| Consumer/configuration path | Accountable role and migration |
| --- | --- |
| `.github/workflows/ci.yml` | H: Sentropic build/release owner; M3 source-link deletion |
| `.gitignore` | H: documentation/build owner; update active links or mark history |
| `.graphify/GRAPH_REPORT.md` | H: documentation/build owner; update active links or mark history |
| `.graphify/cache/ca5fde6c0b9aab70dfa7ba2142d7be760e9c5b701c4da66db484edb5f98c2997.json` | H: documentation/build owner; update active links or mark history |
| `.graphify/cache/ee0e5fc7ec71f833110c1256693f2832e18f2955667007e8fa59be35e83e24e9.json` | H: documentation/build owner; update active links or mark history |
| `.graphify/graph.html` | H: documentation/build owner; update active links or mark history |
| `.graphify/graph.json` | H: documentation/build owner; update active links or mark history |
| `.track/events.jsonl` | H: conductor's immutable append-only evidence; never rewrite historic package names |
| `Makefile` | H: Sentropic build/release owner; M3 source-link deletion |
| `PLAN.md` | H: documentation/build owner; update active links or mark history |
| `README.md` | H: documentation/build owner; update active links or mark history |
| `TODO.md` | H: documentation/build owner; update active links or mark history |
| `TRANSITION.md` | H: documentation/build owner; update active links or mark history |
| `docs/comments-annotations/plan/BRANCH_P1_TEMPLATE.md` | H: documentation/build owner; update active links or mark history |
| `docs/comments-annotations/plan/PLAN_COMMENTS_ANNOTATIONS.md` | H: documentation/build owner; update active links or mark history |
| `docs/sentropic-app-capitalisation-inventory.md` | H: documentation/build owner; update active links or mark history |
| `docs/specs/decisions/cluster-mesh-r14/dossier.json` | H: documentation/build owner; update active links or mark history |
| `docs/uat/2026-06-03-chat-tools-fk-forensics.md` | H: documentation/build owner; update active links or mark history |
| `package-lock.json` | H: consumer/release owner; replace active source links with qualified UI/runtime pair in M3 |
| `packages/cited-source-viewer/README.md` | H: corresponding package owner; audit public contracts |
| `packages/cited-source-viewer/src/index.ts` | H: corresponding package owner; audit public contracts |
| `packages/cowork-bridge/README.md` | H: cowork bridge owner; preserve handoff contract |
| `packages/cowork-bridge/package.json` | H: cowork bridge owner; preserve handoff contract |
| `packages/cowork-bridge/src/index.ts` | H: cowork bridge owner; preserve handoff contract |
| `packages/cowork-desktop/README.md` | H: cowork desktop owner; runtime import and packaging migration |
| `packages/cowork-desktop/package.json` | H: cowork desktop owner; runtime import and packaging migration |
| `packages/cowork-desktop/packaging/entry.mjs` | H: cowork desktop owner; runtime import and packaging migration |
| `packages/cowork-desktop/packaging/esbuild.config.mjs` | H: cowork desktop owner; runtime import and packaging migration |
| `packages/cowork-desktop/src/runner/cowork-runner.ts` | H: cowork desktop owner; runtime import and packaging migration |
| `scripts/ci/publishable-classification.test.mjs` | H: Sentropic build/release owner; M3 source-link deletion |
| `scripts/ci/publishable-pack.test.mjs` | H: Sentropic build/release owner; M3 source-link deletion |
| `scripts/test-api-image-canonical.sh` | H: Sentropic build/release owner; M3 source-link deletion |
| `tools/memory-mcp-l5/artifacts/lock-snapshots/3bdcfa350d278ce118ae64486bbb3bde197797f56cbad3ca06517c469419da12.package-lock.json` | H: documentation/build owner; update active links or mark history |
| `tools/memory-mcp-l5/artifacts/lock-snapshots/4efbef054eda8a5d791d5e878448ce8e77471b39007e1665600605a3c55ca3c6.package-lock.json` | H: documentation/build owner; update active links or mark history |
| `tools/memory-mcp-l5/artifacts/lock-snapshots/5a5e4d7b4800526fbbaf7830486c57f7bc1c0835ae9688c37b152985add3da72.package-lock.json` | H: documentation/build owner; update active links or mark history |
| `tools/memory-mcp-l5/artifacts/lock-snapshots/5fed299021820c64d0ccd4996e28022ad20e24d5c8977a0566d0f106ce3e851a.package-lock.json` | H: documentation/build owner; update active links or mark history |
| `tools/memory-mcp-l5/artifacts/lock-snapshots/9e360b55538ac454c12d272340c2ec5d9ea5ea73ca70c85a08ea5e5552b87377.package-lock.json` | H: documentation/build owner; update active links or mark history |
| `tools/memory-mcp-l5/artifacts/lock-snapshots/cffe5de7f1fc2051fb32019891cf1960ae0814215945676b7515652faa15b4ae.package-lock.json` | H: documentation/build owner; update active links or mark history |
| `tools/memory-mcp-l5/artifacts/lock-snapshots/e23ff8fb080b467d8fda8f77e186309066d3fbe38a74cf1de39d65819fe3bd99.package-lock.json` | H: documentation/build owner; update active links or mark history |
| `tools/memory-mcp-l5/artifacts/lock-snapshots/ecda75e7256418ad799a8d6dd9433ccdce0b3f20ff3894e1c82472afdd0cc054.package-lock.json` | H: documentation/build owner; update active links or mark history |
| `track/TRACK.md` | H: documentation/build owner; update active links or mark history |
| `ui/package-lock.json` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/package.json` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/app.css` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/adapters/checkpointHostAdapter.ts` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/chat/agents-feed-adapter.ts` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/chat/chat-core-host-adapter.ts` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/chat/comment-adapter.ts` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/chat/comment-host-adapter.ts` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/chat/context-adapter.ts` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/chat/documentHostAdapter.ts` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/chat/tool-scope-adapter.ts` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/chat/web-host-adapter.ts` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/components/ChatPanel.svelte` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/components/ChatWidget.svelte` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/components/Header.svelte` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/components/StreamMessage.svelte` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/components/Toast.svelte` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/components/chat/AppChatPanel.svelte` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/stores/streamHub.ts` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/upstream/chrome-host-adapter.ts` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/lib/utils/markdown.ts` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/src/routes/+layout.svelte` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/tests/chat-tool-scope-workspace-type.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/chat/agents-feed-adapter.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/chat/comment-adapter.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/chat/context-provider.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/components/chat/AppChatPanel-boundary.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/components/chat/ChatTimeline.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/components/chat/ChatWidget-agents-list.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/components/chat/ChatWidget-shell-state.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/components/chat/ChatWidget-tab-bar.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/components/chat/ChatWidget-wrapper.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/components/chat/StreamMessage-wrapper.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/stores/localTools.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/utils/chat-run-projection.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/utils/chat-steer.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/utils/chat-tool-scope.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/utils/checkpointDelta.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/utils/localToolStreamSync.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/vscode-ext/bash-policy-banner.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/tests/vscode-ext/tool-permissions.test.ts` | H: app/extension qualification owner; migrate imports/assertions |
| `ui/vscode-ext/local-tools-adapter.ts` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
| `ui/vscode-ext/webview-entry.ts` | H: web/Chrome/VSCode integration owner; adapt public UI/runtime ports |
