# @sentropic/chat-runtime

Sentropic owns session state, stream assembly, transport/replay and local-tool execution.
Hosts create and dispose runtimes independently of view mounts. The visual package receives data and commands.

## Host composition

```ts
import { createConversationRuntime } from '@sentropic/chat-runtime/state/conversationRuntime';
import { createDefaultTransport } from '@sentropic/chat-runtime/client/transport';
import { createStreamHub } from '@sentropic/chat-runtime/client/streamHub';

const transport = createDefaultTransport('https://api.example.test/api/v1');
const streamClient = createStreamHub({
  getBaseUrl: () => 'https://api.example.test/api/v1',
  getAuthState: () => true,
});
const runtime = createConversationRuntime(sessionId, { host: { ...transport, streamClient } });
await runtime.initialize();
// Inject runtime as snapshots and runtime.commands into ChatConversation.
// Keep it above view mounts. On session release: runtime.dispose(); streamClient.reset();
```

The host supplies auth-aware transport and optional `contextProvider`, `documents`, `checkpointHost`,
`sendPayload`, `localTools` and `authorizeLocalTool` ports. `sendPayload` carries domain tool scope and
definitions; generic commands add session, content, model, contexts and ready attachments. Platform
execution requires an explicit authorization adapter. The missing-adapter default remains `() => false`.

An authorization adapter may return `true`, `false`, `'pending'`, or a promise of those values. Pending
decisions have a bounded wait. A view's Allow command asks the host adapter again with `decision: 'allow'`;
only the host's explicit `true` grants execution. Denial, missing adapters and timeout never run a tool.
Call execution and result posting are deduplicated across replay; runtime disposal cancels pending grants.

## Public modules

- `state/conversationRuntime`: host-owned session binding and complete conversation commands.
- `client/*`: transport, stream hub, replay/history and wire contracts.
- `state/chatSessionRuntime`, `state/chatLoopController`, `state/chatProjection`: session/loop/projection.
- `checkpoints`: mutation classifier, checkpoint state and host contract.
- `comments`: retrieval/state/runtime; inject pure visual label helpers into `createCommentRuntime`.
- `documents`: attachment lifecycle helpers and generated-file extraction.
- `context`: context selection and host module.
- `stores/localTools`: platform adapter, tool definitions and permission state.

The export map lists the exact public subpaths. Runtime has no value import from visual implementations.
Its optional UI peer supplies normalized TypeScript data contracts; the packed runtime's Node entries
work without loading Svelte views. Both packages are qualified together for visual consumers.

## Release preparation

`make pack-chat-runtime ENV=test-chat` builds and guards the compiled candidate. CI validates it with
the visual package. Dormant `publish-chat-runtime` and bootstrap token targets use the same exact-artifact
guard as existing packages. The main-only CI publisher precedes a selected UI publisher; root lockfile
changes do not select publication. The explicit bootstrap target is one package, never `all`.

This candidate is unpublished. Initial registry bootstrap and OIDC configuration require the npm administrator;
the P1 migration does not authorize publication or a Design System custody change.
