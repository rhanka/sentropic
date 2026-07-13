# SPEC — L0 session-runtime extraction (chat surfaces prerequisite, D7)

Architectural blueprint (Opus). Prerequisite for any placement MOVE that can remount the chat view: today the session runtime is component-local, so a re-parent = a fresh controller = detached stream, dropped attachments, double/zero-handled pending tool calls. L0 hoists the runtime to a surface-independent owner so "move chat" is never "restart chat". This is the DESIGN; L0-exec (Sonnet, Opus-reviewed) mechanically moves code against it.

## 1. Current ownership (verified in `ui/src/lib/components/chat/AppChatPanel.svelte`)
Component-local, dies on unmount:
- **Controller**: `const ctrl = createChatLoopController(...)` (L343) + `ctrl.attachHost({ transport })` (L346). Owns messages, projection, local-tool machine, pending-tool permission prompts.
- **Stream subscriptions**: `streamHub` keys — `sessionTitlesSseKey` (L633), `localToolsHubKey` (L667); `ctrl.attachStream/detachStream`; teardown at L3097 (`ctrl.detachStream()`, `ctrl.detachLocalToolMachine()`).
- **Composer state**: `input`/`draft` (L388/L418), `composerAttachments` (L419), `attachmentBand` (derived).
- **Session UI state**: `checkpointsByAnchorMessageId` (L628), `checkpointActionInFlight`, `todoRuntimePanel`/`todoRuntimeCollapsed`/`todoRuntimeDeleteInFlight` (L661-663), `errorMsg`.
- **Host adapters**: `checkpointHost` (L26), `chatCoreHost` transport.

## 2. Target ownership
Introduce a framework-neutral **`ChatSessionRuntime`** owner, created ABOVE the surface (at `ChatWidget` level, once per open chat session), passed DOWN into the panel view. The panel (`AppChatPanel` / `ChatPanelShell`) becomes a pure VIEW: it reads runtime snapshots and calls runtime methods; it constructs NOTHING session-scoped. Re-parenting/remounting the view rebinds to the SAME runtime instance (DOM move) or rehydrates from a snapshot (process boundary).

### 2.1 Runtime factory (chat-ui, `packages/chat-ui/src/state/chatSessionRuntime.ts`)
Framework-neutral (no Svelte/DOM). Composes the existing pure pieces (chatLoopController, chatDraft, chatAttachments, chatSessionHydration) under one lifecycle:
```ts
type ChatSessionRuntime = {
  controller: ReturnType<typeof createChatLoopController>; // the ctrl, already framework-neutral
  // composer
  getDraft(): string; setDraft(v: string): void;
  getAttachments(): ChatComposerAttachmentDraft[]; setAttachments(a): void;
  // session UI state the view renders but does not own
  getCheckpoints(): Map<string, ChatCheckpoint>;
  getTodoRuntime(): TodoRuntimePanelState | null; setTodoRuntime(...): void;
  // lifecycle
  attach(host: { transport; streamClient; checkpointHost }): void; // idempotent
  snapshot(): ChatSessionRuntimeSnapshot;   // serializable — for cross-process rehydrate (D7)
  restore(s: ChatSessionRuntimeSnapshot): void;
  subscribe(cb: () => void): () => void;    // view re-renders on change
  dispose(): void;                          // ONLY on session close, never on a move
};
function createChatSessionRuntime(sessionId: string, config): ChatSessionRuntime;
```
Key invariant: `dispose()` is called on SESSION CLOSE, not on a placement move. A move rebinds the view to the live runtime; it never calls `dispose()`.

### 2.2 Ownership boundary
- `ChatWidget` (host) constructs `createChatSessionRuntime(sessionId)` and keeps it alive across placement changes; provides it to the panel via prop/context.
- `AppChatPanel`/`ChatPanelShell` consume it; they no longer call `createChatLoopController` or own stream keys/attachments/drafts.
- On a placement move: the placement controller's `CommitFn` (D13) re-parents the container; the runtime instance is untouched; the view unmounts+remounts and re-subscribes to the SAME runtime.

### 2.3 Cross-process rehydrate (D7, vscode webview destroyed)
When the host cannot keep the JS instance alive (webview disposed/recreated), the host: (1) calls `runtime.snapshot()` before teardown (or persists it continuously), (2) after the new surface loads, `createChatSessionRuntime(...).restore(snapshot)` + re-`attach`, resubscribing the stream. The snapshot is serializable (messages, draft, attachments-by-ref, pending-tool state, checkpoints). **Tool results MUST be idempotently keyed** (by `toolCallId`) so a resubscribe never re-posts a pending tool result.

## 3. Migration approach (behavior-preserving, incremental — the L0-exec contract)
NO user-visible change; the gate is "identical behavior + all existing tests green". Slices (each an atomic commit, Opus-reviewed):
- **L0a** — extract `createChatSessionRuntime` composing ctrl + draft + attachments + checkpoints/todo, with unit tests (framework-neutral). Do NOT yet rewire the component.
- **L0b** — `ChatWidget` constructs the runtime and passes it to `AppChatPanel`; `AppChatPanel` reads `runtime.controller` instead of constructing `ctrl`; drafts/attachments/checkpoints/todo read from the runtime. Delete the component-local constructions (no dual path).
- **L0c** — move stream-key ownership + `attach/detach` into the runtime; the view no longer manages `sessionTitlesSseKey`/`localToolsHubKey`; teardown moves to `runtime.dispose()` at session close.
- **L0d** — `snapshot()`/`restore()` + idempotent tool-result keys + tests simulating an unmount→remount (same runtime) and a snapshot→restore (new runtime) with an in-flight stream + a pending tool call.

## 4. Test-first definition of done (the L0-exec gate)
- Unit: `chat-session-runtime.test.ts` — attach idempotent; snapshot/restore round-trips messages+draft+attachments+pending-tool; dispose tears down once; subscribe/unsubscribe.
- Regression: the existing `chat-loop-controller.spec.ts` + AppChatPanel boundary tests stay green (behavior unchanged).
- Anti-restart: a test that unmounts+remounts the VIEW against the SAME runtime keeps the message list + in-flight stream (no re-subscribe storm, no double tool post).
- Full `make test-ui` + `make test-chat-ui` + `-dom` green; `make typecheck-ui`/`-chat-ui` clean.

## 5. Tier
- **This blueprint = Opus.** **L0a/L0d (runtime factory + snapshot/idempotency) = Codex 5.6-luna-xhigh or Opus** (subtle lifecycle). **L0b/L0c (mechanical rewire, delete dual path) = Sonnet, Opus-reviewed** (guarded by behavior-preserving tests). Any place the mechanical move reveals hidden component→runtime coupling → escalate to Opus, do not paper over.

## 6. Risks
- Hidden coupling: component effects that read `ctrl` reactively — must become runtime subscriptions, not new state. No dual source of truth.
- Stream resubscribe storms on remount — dedupe by key; the runtime holds the single subscription.
- Checkpoint/todo host adapters are app-local (`$lib/adapters`) — the runtime takes them as INJECTED host deps (stay app-side), not moved into the module.
