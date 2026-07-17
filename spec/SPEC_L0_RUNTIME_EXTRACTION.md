# SPEC — L0 session-runtime extraction (chat surfaces prerequisite, D7)

Architectural blueprint (Opus, revised after Codex 5.6-xhigh adversarial review — verdict was *needs-revision*, reconciled here). Prerequisite for any placement MOVE that can remount the chat view: today the session runtime is component-local, so a re-parent = a fresh controller = detached stream, dropped attachments, double/zero-handled pending tool calls. L0 hoists the runtime to a surface-independent owner so "move chat" is never "restart chat".

**Load-bearing correction from review:** L0 is NOT mostly Sonnet-mechanical. It separates THREE events that today collapse together — (a) view unmount/remount, (b) host/stream detach, (c) process destruction — and must not conflate them. The runtime is exposed as a **snapshot/command API (never the raw controller)**; the view/component→runtime cutover is ONE atomic boundary (not two slices); cross-process restore depends on a **new backend contract** (server-enforced tool-result idempotency + cursor replay). Only the final prop rewiring + mechanical cleanup is Sonnet; the lifecycle correctness is Luna/Opus.

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
Framework-neutral (no Svelte/DOM). Composes the existing pure pieces (chatLoopController, chatDraft, chatAttachments, chatSessionHydration) under one lifecycle. It exposes a **snapshot/command API — NOT the raw controller** (a raw controller handle would be a second writable source of truth; the view must read snapshots and issue commands only):
```ts
type ChatSessionRuntime = {
  // read: the view renders from an immutable snapshot, never from live internals
  snapshot(): ChatSessionSnapshot;          // messages, draft, attachments, checkpoints, todo, pending-tool
  subscribe(cb: (s: ChatSessionSnapshot) => void): () => void;
  // commands: every mutation goes through a command (no direct field writes)
  send(...): void; retry(id): void; stop(id): void; setDraft(v): void; setAttachments(a): void; /* … */
  // lifecycle — THREE distinct operations, never conflated:
  attach(host: { transport; streamClient; checkpointHost }): void; // (re)establish live I/O; idempotent by attachGeneration
  bindView(): () => void;                   // a VIEW mounts; returns unbind. Remount = unbind→bind, runtime untouched.
  serialize(): ChatSessionSnapshotSerializable; // for cross-process rehydrate (D7); excludes live SSE/AbortController/timers
  restore(s: ChatSessionSnapshotSerializable): void;
  dispose(): void;                          // ONLY on SESSION CLOSE — never on a move or a view remount
};
function createChatSessionRuntime(sessionId: string, config): ChatSessionRuntime;
```
Invariants: (1) the view NEVER holds the controller — only `snapshot()` + commands; (2) `bindView()`/`attach()`/`dispose()` are separate — a placement move is `unbind → (re-parent) → bind`, never `dispose`; (3) `attach()` is idempotent via an **attachGeneration** counter so a remount cannot create a second live stream subscription; today's `attachStream()` (always detach + new random key) and `detachLocalToolMachine()` (clears pending + timers) MUST be changed to this generation-guarded semantics first.

### 2.1b Session coordinator (host, above the surfaces)
An explicit **session coordinator** owns the runtime instance per open session and lives ABOVE both `ChatDock` and the placement surfaces (at `ChatWidget`). It is the single thing that survives placement moves; it hands the runtime's snapshot/command API down. Placement (D13 CommitFn) re-parents the container; the coordinator keeps the runtime alive; the view re-`bindView()`s.

### 2.2 Ownership boundary
- `ChatWidget` (host) constructs `createChatSessionRuntime(sessionId)` and keeps it alive across placement changes; provides it to the panel via prop/context.
- `AppChatPanel`/`ChatPanelShell` consume it; they no longer call `createChatLoopController` or own stream keys/attachments/drafts.
- On a placement move: the placement controller's `CommitFn` (D13) re-parents the container; the runtime instance is untouched; the view unmounts+remounts and re-subscribes to the SAME runtime.

### 2.3 Cross-process rehydrate (D7, vscode webview destroyed) — needs a NEW backend contract
The live parts (SSE connection, AbortControllers, timers, poll loops) CANNOT be snapshotted — only re-established. A snapshot carries messages, draft, attachments-by-ref, checkpoints, and pending-tool state **including each stream's `lastAppliedSequence`**. Recovery sequence (host-driven):
1. `restore(snapshot)` into a QUIESCENT runtime (no live I/O yet);
2. `attach(freshHostAdapters)`;
3. resume each active stream from **`lastAppliedSequence + 1`** via a durable cursor replay, OR fetch authoritative session history (chat-core `history`); today `streamHub` only retains IN-MEMORY history — durable replay is NOT yet implemented;
4. restart exactly one poll loop per active job id;
5. replay ONLY unacknowledged tool results, guarded by a **server-enforced idempotency key** on `POST /messages/:id/tool-results` (which today has NO idempotency key — see dependency below);
6. NEVER auto-rerun a local tool whose execution outcome is unknown unless the extension host keeps a durable **operation journal** (critical for file edits / shell commands).

**NEW DEPENDENCY (cross-lane, blocks L0d only):** server-enforced tool-result idempotency + a durable stream-cursor replay contract. This is an `api/**` + chat-core change, NOT chat-ui. It gates cross-process restore (vscode), NOT the in-DOM move (web app, which keeps the JS instance alive). Escalate to the api/backend lane; track as a prerequisite for L0d, not L0a–L0c.

**SECOND DEPENDENCY (chat-ui internal, blocks L0d only — discovered by the L0a build 2026-07-17):** `ChatLoopController` exposes pending local-tool prompts ONLY as live state via `getSnapshot()` — there is NO controller-owned, JSON-safe pending-tool descriptor **export/import** API (verified against `chatLoopController.ts`; interactive + local-tool methods that DO exist: `send`/`retry`/`stop`/`edit`/`setFeedback`, `attachLocalToolMachine`/`handleLocalToolStreamEvent`/`decideLocalToolPermission`/`resetLocalToolMachineState`/`detachLocalToolMachine`). So `serialize()/restore()` of EXECUTABLE pending-tool state is impossible without extending the controller — faking it in the runtime would re-fork ownership (the hollow-façade failure). **Decision (conductor, 2026-07-17): descope pending-tool serialize/restore to L0d.** L0a's `serialize()` carries ONLY plain-JSON state (messages/draft/attachments/checkpoints/todo/lastAppliedSequence) and explicitly EXCLUDES pending-tools; L0a still delivers the sole-owner command surface + purity + behavioral tests for the in-DOM surface moves (which never serialize). L0d prerequisite = extend `ChatLoopController` with a controller-owned JSON-safe pending-tool descriptor export/import (quiescent restore, no timers/executors, multiple prompts, carries `lastAppliedSequence`).

## 3. Migration approach (behavior-preserving — the L0-exec contract, re-ordered per review)
NO user-visible change; the gate is "identical behavior + the mount→remount→restore lifecycle test green" (§4). Slices — note L0b/L0c are ONE atomic cutover (they cannot be separate: after a partial cutover the view may still own stream teardown, so a remount detaches the runtime's stream):
- **L0a — contract + runtime state + lifecycle semantics.** Define `ChatSessionSnapshot`, the command set, host ports, the **attachGeneration**-guarded idempotent `attach`, the stream cursor (`lastAppliedSequence`), and the tool-result idempotency contract. Implement the runtime state + lifecycle unit tests. The runtime exists but is NOT yet wired (an unused runtime alongside the old controller gives false confidence — so L0a's DoD is the lifecycle contract + tests, not "it compiles").
- **L0b+L0c — ONE guarded cutover.** In a single atomic boundary: `ChatWidget`/coordinator constructs the runtime; move stream + local-tool + draft/attachment/checkpoint ownership INTO it (generation-guarded, idempotent); rewire `AppChatPanel` to render from `snapshot()` + issue commands; move teardown to `runtime.dispose()` at session close. A **temporary one-way bridge** (old→new read) is allowed DURING the cutover; two writable sources are never allowed. Delete the old controller/state paths ONLY after the lifecycle regression test (§4) passes.
- **L0d — cross-process restore.** `serialize()`/`restore()` + cursor replay + server-enforced tool-result idempotency + local-tool operation journal. **Blocked on the backend dependency (§2.3).** Web (in-DOM move) does not need L0d; vscode does.

## 4. Test-first definition of done (the L0-exec gate)
- Unit: `chat-session-runtime.test.ts` — attach idempotent (attachGeneration: a 2nd attach does not create a 2nd subscription); command→snapshot updates; serialize/restore round-trips messages+draft+attachments+pending-tool+`lastAppliedSequence`; dispose tears down once; subscribe/unsubscribe.
- **Lifecycle integration (the prerequisite for deleting the old path)** `chat-session-runtime.lifecycle.spec.ts`: (1) mount a real view against one runtime; (2) emit an in-flight content event + a pending local-tool call; (3) unmount+remount the view; (4) assert EXACTLY ONE active stream subscription and EXACTLY ONE tool execution; (5) emit replayed/duplicate events + a terminal event; (6) serialize; (7) new runtime, restore, replay the stream, simulate a LOST tool-result ack; (8) assert one server-side tool-result effect, one resumed job, no duplicate message events, one terminal transition.
- Regression: `chat-loop-controller.spec.ts` + AppChatPanel boundary tests stay green (behavior unchanged).
- Full `make test-ui` + `make test-chat-ui` + `-dom` green; typechecks clean.

## 5. Tier (revised — L0 is NOT mostly Sonnet)
- **This blueprint = Opus** (+ Codex-xhigh review, done).
- **L0a (runtime state + lifecycle contract + tests) = Opus or Codex 5.6-luna-xhigh** — attachGeneration idempotency, cursor, snapshot shape are subtle correctness.
- **L0b+L0c (the guarded cutover: reactive coupling, session switching, async hydration races, stream generation, stale-callback handling, poll cancellation, source-of-truth deletion) = Luna/Opus, NOT Sonnet.** "Delete the dual path" is itself a Luna/Opus correctness gate.
- **L0d = Opus/Luna + blocked on the backend idempotency/replay contract (§2.3).**
- **Sonnet** only for the FINAL prop rewiring + mechanical cleanup AFTER the lifecycle contract + tests exist and pass.

## 6. Risks
- Hidden coupling: component effects that read `ctrl` reactively — must become runtime subscriptions, not new state. No dual source of truth.
- Stream resubscribe storms on remount — dedupe by key; the runtime holds the single subscription.
- Checkpoint/todo host adapters are app-local (`$lib/adapters`) — the runtime takes them as INJECTED host deps (stay app-side), not moved into the module.

## 7. Peer review trail
- Opus 4.8 (design) + Codex 5.6-xhigh (adversarial, verdict *needs-revision*, reconciled here): raw-controller exposure → snapshot/command API + session coordinator + bindView≠attach≠dispose (§2.1/§2.1b); snapshot insufficient → cursor replay + server idempotency + operation journal, live I/O not snapshottable (§2.3); L0b/L0c not separable → one guarded cutover + temporary one-way bridge (§3); lifecycle integration test is the prerequisite to delete the old path (§4); re-tier L0b/L0c to Luna/Opus (§5); NEW backend dependency for cross-process restore (§2.3).
