# @sentropic/chat-ui

Svelte chat views, normalized data/command ports and presentation helpers.
Sentropic client execution lives in `@sentropic/chat-runtime`. Views receive state and callbacks;
hosts own authentication, platform capabilities and runtime lifetime.

## 1.0.0 migration

This major release removes runtime implementations and their forwarding exports. Import transport,
replay, session/controller/projection state, checkpoints, local tools, model selection and optional
module state from the corresponding `@sentropic/chat-runtime` subpaths. The visual root barrel no
longer exports them. See `spec/CHAT_MIGRATION_P1.md` in the repository for the release notice.

`ChatConversation` requires `snapshots` and `commands`. Create the runtime above placement/tab/view
mounts and dispose it when the host releases the session, rather than when the view unmounts.

```svelte
<script lang="ts">
  import ChatConversation from '@sentropic/chat-ui/components/ChatConversation.svelte';
  import type { ChatConversationCommands, ChatConversationSnapshots } from '@sentropic/chat-ui/conversation';
  export let snapshots: ChatConversationSnapshots;
  export let commands: ChatConversationCommands;
</script>

<ChatConversation {snapshots} {commands} features={{ attachments: true, documents: true }} />
```

The snapshot contains normalized timeline items, catalog/context choices, attachments and permission
states. Commands bind sending, model/context selection, edit/retry/stop/feedback/steer, upload/removal,
generated-file download and permission decisions. The view never creates or disposes the runtime.
Missing host permission approval denies local execution in the runtime.

## Public surface

- `components/ChatConversation.svelte`: injected conversation assembly, optional module snippets.
- `conversation`: data-only snapshot and command types.
- `components/ChatWidget.svelte`, `ChatWidgetPager.svelte`, `ChatDock.svelte`: shell, routing and placement.
- `components/ChatPanel.svelte`, `ChatTimeline.svelte`, `ChatComposer.svelte`: visual composition primitives.
- `components/StreamMessage.svelte`: markdown/reasoning/tool rendering; passive injected events need no transport.
- `renderers/registry`: pure host-configured tool-result renderers.
- `comments`: normalized comment types and pure formatting; `comments/CommentsPanel.svelte` receives host-owned state/actions.
- `documents`: attachment/card types and format labels; attachment trays, generated cards and lightbox are views.
- `context`: normalized chip/picker data types. Context selection/retrieval lives in the runtime.
- `stores/chatWidgetLayout` and `state/chatPlacement*`: visual layout and placement intent.
- `theme.css`: opt-in compiled theme stylesheet; see `THEMING.md`.

The package export map and `export-manifest.json` are the exact public inventory.
Host-specific renderers, OAuth, workspace resolution and platform execution remain host concerns.

## Shell snippets

ChatWidget accepts typed header/content/pager snippets. Render `renderContentGate`'s ready body once
after host onboarding succeeds. Header actions and tabs remain outside that gate. Pass agent rows and
callbacks through `agentsList`; pass host navigation state through `agentsView`.
The separate ChatPanel `renderShell` contract remains available.

## Development and artifacts

Run the repository Make targets with an isolated test environment:

```sh
make typecheck-chat-ui ENV=test-chat
make test-chat-ui ENV=test-chat
make test-chat-ui-dom ENV=test-chat
make pack-chat-ui ENV=test-chat
```

Guarded packing preprocesses Svelte components and produces public `dist` entrypoints. Clean-consumer
qualification installs the exact UI/runtime archives together. Publication requires Sentropic CI and
the package release owner's grant; this migration does not transfer custody to the Design System.
