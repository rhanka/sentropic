# @sentropic/chat-core

Sentropic owns the orchestration core and client runtime. The root entry exports the existing
server orchestration contracts, history projection and in-memory adapters. Client state, transport,
replay and local tools are exported only through `@sentropic/chat-core/runtime` and its explicit
subpaths. Importing the root does not initialize the client runtime.

## Client runtime

```ts
import { createConversationRuntime } from '@sentropic/chat-core/runtime';
import { createDefaultTransport } from '@sentropic/chat-core/runtime/client/transport';
import { createStreamHub } from '@sentropic/chat-core/runtime/client/streamHub';

const transport = createDefaultTransport('https://api.example.test/api/v1');
const streamClient = createStreamHub({
  getBaseUrl: () => 'https://api.example.test/api/v1',
  getAuthState: () => true,
});
const runtime = createConversationRuntime(sessionId, { host: { ...transport, streamClient } });
await runtime.initialize();
// Inject snapshots and runtime.commands into ChatConversation.
// On session release: runtime.dispose(); streamClient.reset();
```

Hosts own the runtime lifetime independently of view mounts. The visual package receives snapshots
and injected commands and imports runtime contracts as types only. Runtime and local-tool execution
remain in Sentropic, outside the Design System. This packaging change leaves P0 and all acceptance gates intact.

Runtime consumers supply the optional package peers Svelte 5 and `@sentropic/chat-ui` 0.34.1 or 1.x.
The latter provides neutral model utilities and normalized types; runtime loads no visual component.
Server consumers of the root entry do not need either peer.

The runtime subpaths include `conversation` (injected view contracts), `hosts/types` (local tools),
`client/*` (transport, replay and streams), `state/*` (session/controller/projection), `checkpoints`,
`comments`, `documents`, `context`, `stores/localTools` and `utils/*`. The export map lists each public entry.
Hosts inject auth-aware transport, context, document I/O, checkpoints, payloads and tool authorization.
Comments receive pure visual label helpers through `createCommentRuntime`.

Tool execution requires explicit host authorization. The missing-adapter predicate remains `() => false`.
Pending decisions expire; missing approval, denial and timeout execute no tool. Replay deduplicates execution
and result posting. Runtime disposal cancels pending grants.

## Validation and release

`make typecheck-chat-core test-pkg-chat-core pack-chat-core ENV=test-chat-p1` builds, tests and guards the
compiled artifact. CI qualifies the exact packed archive in a clean consumer against published peers.
Version 0.2.0 adds the runtime subpaths to the existing package; its established OIDC publisher handles
publication after merge. There is no standalone runtime package, alias or bootstrap requirement.
Owner U0, visual transfer approval and downstream parity gates remain required in their existing sequence.
