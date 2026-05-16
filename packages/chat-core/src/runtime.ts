/**
 * BR14b Lot 9/10/11/12 — chat orchestration extraction.
 *
 * `ChatRuntime` is the home of chat orchestration that lives above the
 * persistence/stream ports already extracted in Lots 4/6/7/8 + the mesh
 * boundary port introduced in Lot 10:
 *
 *   Lots 4/6/7/8 (DONE)   — CheckpointStore + MessageStore + StreamBuffer
 *                            + SessionStore ports + Postgres adapters.
 *                            `chat-service.ts` delegates each persistence
 *                            call to its adapter.
 *
 *   Lot 9   (DONE)        — Established the `ChatRuntime` shell with DI of
 *                            the four existing ports. Migrated the smallest
 *                            atomic orchestration slice
 *                            (`finalizeAssistantMessageFromStream`) into
 *                            the runtime.
 *
 *   Lot 10  (DONE)        — Designed `MeshDispatchPort` (contracts-free
 *                            mesh invocation surface) and migrated
 *                            `acceptLocalToolResult` + its private helper
 *                            `extractAwaitingLocalToolState` into the
 *                            runtime. Replaces the `invokeModel?: unknown`
 *                            placeholder with the typed
 *                            `mesh: MeshDispatchPort` DI hook.
 *
 *   Lot 11  (DONE)        — Refactor `postgresChatCheckpointAdapter` to
 *                            strictly implement the generic
 *                            `CheckpointStore<ChatState>` port (load /
 *                            save / list / delete + optional tag/fork)
 *                            and migrate the three session-aware
 *                            checkpoint methods
 *                            (`createCheckpointForSession` /
 *                            `listCheckpointsForSession` /
 *                            `restoreCheckpointForSession`) from the
 *                            adapter into the runtime as orchestration:
 *                            `ChatRuntime.createCheckpoint` /
 *                            `listCheckpoints` / `restoreCheckpoint`.
 *                            Composes `CheckpointStore.save/load/list/delete`
 *                            + `MessageStore.listForSession` +
 *                            `MessageStore.deleteAfterSequence` +
 *                            `SessionStore.touchUpdatedAt`. Drops the
 *                            `as unknown as CheckpointStore<ChatState>`
 *                            cast that lived in `chat-service.ts` Lots
 *                            9/10 because the adapter is now strictly
 *                            typed.
 *
 *   Lot 12  (THIS LOT)    — Migrate `retryUserMessage` (69 l) +
 *                            `createUserMessageWithAssistantPlaceholder`
 *                            (~115 l) into `ChatRuntime`. Both methods
 *                            blend persistence (MessageStore +
 *                            SessionStore) with two app-level concerns
 *                            that must not cross into chat-core: AI
 *                            settings + model-catalog lookup (resolves a
 *                            `{providerId, modelId}` pair from user
 *                            settings + request overrides + legacy
 *                            inference) and message-contexts
 *                            normalization (validates an inbound
 *                            `CreateChatMessageInput` slice against the
 *                            domain's `ChatContextType` union). Per
 *                            SPEC §5 and the prevailing Lot 10 pattern
 *                            (`normalizeVsCodeCodeAgent`), both surfaces
 *                            cross the port as **Option A callbacks** on
 *                            `ChatRuntimeDeps` rather than as new ports:
 *                            each is a single pure function with no
 *                            multi-method shape that other lots would
 *                            reuse. The chat-service adapter wires
 *                            `resolveModelSelection` (a combined call
 *                            over `settingsService.getAISettings` +
 *                            `getModelCatalogPayload` +
 *                            `inferProviderFromModelIdWithLegacy` +
 *                            `resolveDefaultSelection`),
 *                            `normalizeMessageContexts` (binds
 *                            `ChatService.normalizeMessageContexts`),
 *                            and `isChatContextType` (binds the module-
 *                            level type guard). chat-core stays contract-
 *                            and api-import free.
 *
 *   Lots 13+ (NEXT)       — Move continuation generation, tool loop,
 *                            reasoning loop, cancel, and finally
 *                            `runAssistantGeneration` itself into the
 *                            runtime. Mesh dispatch routes through
 *                            `deps.mesh.invoke` / `deps.mesh.invokeStream`.
 *
 * Per SPEC §1 / §5 / §14 — chat-core owns single-session orchestration.
 * Mesh access stays delegated through `MeshDispatchPort` so chat-core has
 * zero compile-time dependency on `@sentropic/llm-mesh` or any provider
 * adapter.
 *
 * Behavior preservation is the absolute contract: each migrated method is
 * a verbatim move (line-for-line) of the body that lived in
 * `chat-service.ts` (Lots 9/10) or in `postgresChatCheckpointAdapter`
 * (Lot 11). The only differences are: (a) `this.deps.*` instead of the
 * module-level adapter singletons, (b) helper functions previously
 * defined at module scope in `chat-service.ts` (`asRecord`,
 * `isValidToolName`) are duplicated here as private module-scoped
 * helpers since they are tiny pure utilities, (c) the
 * `normalizeVsCodeCodeAgent` callback is injected via deps because the
 * full normalizer body in `chat-service.ts` is reused by other
 * call-sites, and (d) Lot 11 checkpoint orchestration uses
 * `MessageStore.listForSession` (returns the full `chat_messages` row
 * set) instead of the previous direct `db.select(...)` of the same
 * columns — the resulting `ChatStateSnapshot.messages` payload is shape-
 * identical to the legacy on-disk snapshot.
 */

import type {
  ChatState,
  ChatStateSnapshot,
  ChatStateSnapshotMessage,
} from './types.js';
import type { CheckpointStore } from './checkpoint-port.js';
import type {
  ChatMessageRow,
  ChatMessageWithFeedback,
  MessageStore,
} from './message-port.js';
import type { ChatSessionRow, SessionStore } from './session-port.js';
import type { StreamBuffer, StreamEventTypeName } from './stream-port.js';
import type { StreamSequencer } from './stream-sequencer-port.js';
import type { MeshDispatchPort } from './mesh-port.js';
import type { ChatHistoryTimelineItem } from './history.js';
import type {
  ContextBudgetSnapshot,
  ContextBudgetZone,
} from './context-budget.js';
import { ChatRuntimeCheckpoint } from './runtime-checkpoint.js';
import { ChatRuntimeFinalization } from './runtime-finalization.js';
import { ChatRuntimeMessages } from './runtime-messages.js';
import { ChatRuntimeRunPrepare } from './runtime-run-prepare.js';
import { ChatRuntimeSession } from './runtime-session.js';
import { ChatRuntimeToolDispatch } from './runtime-tool-dispatch.js';

/**
 * BR14b Lot 21b — max characters captured into
 * `AssistantRunLoopState.steerReasoningReplay`. Lifted verbatim from
 * `chat-service.ts` line 2822 pre-Lot 21b (`const STEER_REASONING_REPLAY_MAX_CHARS = 6000`).
 * Lives at module scope so `consumeAssistantStream` can clamp the
 * reasoning replay buffer without taking the constant as an input.
 *
 * Exported (BR14b Lot 22b-5) so the `ChatRuntimeToolDispatch` sub-class
 * can import it for its migrated `consumeAssistantStream` body without
 * duplicating the constant.
 */
export const STEER_REASONING_REPLAY_MAX_CHARS = 6000;

/**
 * Local tool definition input — structural shape mirroring
 * `LocalToolDefinitionInput` exported from
 * `api/src/services/chat-service.ts` (kept identical for external
 * consumers like `queue-manager.ts`). Migrated alongside
 * `acceptLocalToolResult` so callers feed runtime methods directly.
 */
export type LocalToolDefinitionInput = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/**
 * Resume continuation payload — mirrors `ChatResumeFromToolOutputs` in
 * `chat-service.ts` byte-for-byte. Carries `previousResponseId` + an
 * ordered list of merged tool outputs (server-side + local) used by
 * `runAssistantGeneration` resume.
 */
export type ChatResumeFromToolOutputs = {
  previousResponseId: string;
  toolOutputs: Array<{
    callId: string;
    output: string;
    name?: string;
    args?: unknown;
  }>;
};

/**
 * Normalized VsCode code-agent runtime payload — structural shape mirroring
 * `NormalizedVsCodeCodeAgentRuntimePayload` in `chat-service.ts`. Cross
 * the port via DI (deps.normalizeVsCodeCodeAgent) so chat-core stays
 * agnostic of the VsCode-specific normalization body.
 */
export type NormalizedVsCodeCodeAgentRuntimePayload = {
  workspaceKey: string | null;
  workspaceLabel: string | null;
  promptGlobalOverride: string | null;
  promptWorkspaceOverride: string | null;
  instructionIncludePatterns: string[];
  instructionFiles: Array<{ path: string; content: string }>;
  systemContext: {
    workingDirectory: string | null;
    isGitRepo: boolean | null;
    gitBranch: string | null;
    platform: string | null;
    osVersion: string | null;
    shell: string | null;
    clientDateIso: string | null;
    clientTimezone: string | null;
  } | null;
};

/**
 * Internal state extracted from the most recent
 * `awaiting_local_tool_results` status event for an assistant message.
 * Mirrors `AwaitingLocalToolState` in `chat-service.ts` verbatim.
 *
 * Exported (BR14b Lot 22b-3) so the `ChatRuntimeMessages` sub-class can
 * type its private `extractAwaitingLocalToolState` helper without
 * duplicating the shape. Only `acceptLocalToolResult` +
 * `extractAwaitingLocalToolState` consume this type — both methods now
 * live in `runtime-messages.ts`.
 */
export type AwaitingLocalToolState = {
  sequence: number;
  previousResponseId: string;
  pendingLocalToolCalls: Array<{
    id: string;
    name: string;
    args: unknown;
  }>;
  baseToolOutputs: Array<{
    callId: string;
    output: string;
    name?: string;
    args?: unknown;
  }>;
  localToolDefinitions: LocalToolDefinitionInput[];
  vscodeCodeAgent: NormalizedVsCodeCodeAgentRuntimePayload | null;
};

/**
 * DI container for `ChatRuntime`.
 *
 * Four persistence ports already exist in the worktree and are wired in
 * `chat-service.ts` via module-level adapter singletons. The runtime
 * accepts them as constructor dependencies so a future test harness can
 * inject in-memory fakes (SPEC §5: every port ships an `in-memory`
 * reference adapter).
 *
 * `mesh` is the typed MeshDispatchPort introduced in Lot 10 — replaces
 * the `invokeModel?: unknown` placeholder. Carries the model invocation
 * contract used by future continuation/tool/reasoning loop migrations.
 *
 * `normalizeVsCodeCodeAgent` is injected as a callback rather than
 * moved into the runtime because the body in `chat-service.ts` is
 * reused by several other methods (system-prompt build, instruction
 * rendering) that do not migrate into the runtime in this lot.
 */
export type ChatRuntimeDeps = {
  readonly messageStore: MessageStore;
  readonly sessionStore: SessionStore;
  readonly streamBuffer: StreamBuffer;
  /**
   * BR14b Lot 20 — strict monotonic sequence allocator per `streamId`.
   * Decoupled from `streamBuffer` so the runtime can advance the cursor
   * without owning event storage. Concrete proof of contract: the two
   * `writeStreamEvent` calls that previously bracketed
   * `evaluateReasoningEffort` caller-side now live inside the runtime
   * and rely on `streamSequencer.allocate` / `streamSequencer.peek` to
   * keep the shared `streamSeq` cursor in sync without exposing
   * mutation to the caller. Required by upcoming tool-loop migration
   * (Lots 21+).
   */
  readonly streamSequencer: StreamSequencer;
  readonly checkpointStore: CheckpointStore<ChatState>;
  readonly mesh: MeshDispatchPort;
  readonly normalizeVsCodeCodeAgent: (
    input: unknown,
  ) => NormalizedVsCodeCodeAgentRuntimePayload | null;
  /**
   * Lot 12 — resolve `{providerId, modelId}` from optional caller
   * overrides + user AI settings + the active model catalog.
   *
   * Adapter (api/src/services/chat-service.ts):
   *   1. `await settingsService.getAISettings({ userId })`
   *   2. `await getModelCatalogPayload({ userId })`
   *   3. `inferProviderFromModelIdWithLegacy(catalog.models, modelId)`
   *   4. `resolveDefaultSelection({ providerId, modelId }, catalog.models)`
   *
   * Crosses the port as a single callback because chat-core must not
   * import `settingsService` / `model-catalog` (both live in `api/src/`
   * and depend on the provider registry). The shape of the return value
   * mirrors `ModelSelectionPair` from `model-catalog.ts` byte-for-byte
   * (`provider_id` / `model_id` snake_case) so the chat-service delegate
   * stays a one-liner.
   */
  readonly resolveModelSelection: (input: {
    readonly userId: string;
    readonly providerId?: string | null;
    readonly model?: string | null;
  }) => Promise<{
    readonly provider_id: string;
    readonly model_id: string;
  }>;
  /**
   * Lot 12 — normalize a `CreateChatMessageInput` slice (contexts +
   * primaryContextType + primaryContextId) into the
   * `{contextType, contextId}[]` array persisted on `chat_messages.contexts`.
   *
   * Crosses the port as a callback because the body depends on the
   * `ChatContextType` union which is owned by `chat-service.ts`. The
   * runtime is contract-agnostic about which strings are valid context
   * types — it just persists whatever the callback returns.
   */
  readonly normalizeMessageContexts: (input: {
    readonly contexts?: ReadonlyArray<{
      readonly contextType: string;
      readonly contextId: string;
    }>;
    readonly primaryContextType?: string | null;
    readonly primaryContextId?: string | null;
  }) => Array<{ readonly contextType: string; readonly contextId: string }>;
  /**
   * Lot 12 — type guard exposing the `ChatContextType` membership check
   * used in `createUserMessageWithAssistantPlaceholder` to decide
   * whether to write a `SessionStore.updateContext` for an incoming
   * `primaryContextType`. Same rationale as
   * `normalizeMessageContexts`: chat-core stays agnostic of the
   * concrete `ChatContextType` union.
   */
  readonly isChatContextType: (value: unknown) => boolean;
  /**
   * Lot 14a — hydrate the `todoRuntime` payload returned alongside the
   * message list. Crosses the port as an Option A callback (same pattern
   * as Lot 10 `normalizeVsCodeCodeAgent` and Lot 12 `resolveModelSelection`)
   * because the body bundles three api-land helpers
   * (`ensureWorkspaceForUser`, `getWorkspaceRole`, and
   * `todoOrchestrationService.getSessionTodoRuntime`) that chat-core must
   * not import. When undefined the runtime returns `todoRuntime: null` to
   * preserve the legacy behavior of sessions without a workspace.
   */
  readonly hydrateMessagesWithTodoRuntime?: (input: {
    readonly session: ChatSessionRow;
    readonly userId: string;
  }) => Promise<Record<string, unknown> | null>;
  /**
   * Lot 14b — resolve the effective workspace id for a session. Mirrors
   * the body of `ChatService.resolveSessionWorkspaceId` (uses
   * `session.workspaceId` when present, else `ensureWorkspaceForUser`).
   * Crosses the port as an Option A callback because the fallback body
   * imports `workspace-service` which chat-core must not pull in.
   */
  readonly resolveSessionWorkspaceId: (
    session: ChatSessionRow,
    userId: string,
  ) => Promise<string | null>;
  /**
   * Lot 14b — list the documents attached to a chat session for the
   * resolved workspace. Mirrors the body of
   * `ChatService.listSessionDocuments` (joins `context_documents` with
   * `job_queue` to derive the effective status). Crosses the port as
   * an Option A callback because chat-core must not import
   * `drizzle-orm` or the api `db/schema`.
   */
  readonly listSessionDocuments: (input: {
    readonly sessionId: string;
    readonly workspaceId: string | null;
  }) => Promise<ReadonlyArray<ChatSessionDocumentItem>>;
  /**
   * Lot 14b — project stored stream events to assistant detail rows,
   * grouped by message id. Mirrors the body of
   * `ChatService.listAssistantDetailsByMessageId` (single `SELECT`
   * ordered by `stream_id, sequence`). Crosses the port as an Option A
   * callback for the same reason as `listSessionDocuments`.
   */
  readonly listAssistantDetailsByMessageId: (
    messageIds: ReadonlyArray<string>,
  ) => Promise<Record<string, ChatBootstrapStreamEvent[]>>;
  /**
   * Lot 15 — resolve workspace-access flags for the precheck slice of
   * `runAssistantGeneration`. Bundles the three api-only calls
   * (`isWorkspaceDeleted`, `hasWorkspaceRole`, `getWorkspaceRole`) into
   * a single Option A callback because chat-core must not import
   * `workspace-access`. Returns the exact `{ readOnly, canWrite,
   * currentUserRole }` triple the legacy inline block produced.
   */
  readonly resolveWorkspaceAccess: (input: {
    readonly userId: string;
    readonly workspaceId: string;
  }) => Promise<WorkspaceAccessFlags>;
  /**
   * Lot 16a — generate a session title from the last user message and
   * persist it (when the session has no title yet). Bundles the chat-
   * service helpers `generateSessionTitle` + `SessionStore.updateTitle`
   * + `notifyWorkspaceEvent` into a single Option A callback because
   * chat-core must not import `callLLM`, the prompt template registry,
   * or the workspace-event NOTIFY plumbing.
   *
   * Returns the generated title (already persisted) so the caller can
   * observe what happened, or `null` when no title was generated (either
   * because the session already had one, the last user message was
   * empty, or the LLM returned nothing). Implementations MUST be
   * idempotent and safe to call regardless of `session.title` state —
   * the runtime delegates the no-op decision to the callback.
   */
  readonly ensureSessionTitle?: (input: {
    readonly session: ChatSessionRow;
    readonly sessionWorkspaceId: string;
    readonly focusContext: {
      readonly contextType: string;
      readonly contextId: string;
    } | null;
    readonly lastUserMessage: string;
  }) => Promise<string | null>;
  /**
   * Lot 16b — build the full system prompt + tool catalog + context
   * flags consumed by the remainder of `runAssistantGeneration`.
   * Bundles ~605 lines of chat-service-side logic (context flags,
   * allowed-documents resolution, allowed-comments resolution, todo
   * runtime snapshot, tool selection by context-type + workspace-type,
   * server-side tab tool injection, documents block, context block per
   * primary type, history block, todo orchestration block, active tools
   * block, document_generate guidance block, system prompt IIFE) into a
   * single Option A callback because chat-core must not import
   * `drizzle-orm`, `db/schema`, `workspace-service`, `todo-orchestration`,
   * `tab-registry`, the VsCode prompt template registry, the tool
   * definitions catalog, or the chat prompt registry.
   *
   * The runtime's `prepareSystemPrompt` method is a trivial wrapper that
   * forwards the typed input to this callback and returns the typed
   * result struct.
   */
  readonly buildSystemPrompt?: (
    input: BuildSystemPromptInput,
  ) => Promise<BuildSystemPromptResult>;
  /**
   * BR14b Lot 18 — evaluate the reasoning-effort label to request from
   * the mesh for the current message. Bundles the inline 98-line block
   * previously embedded in `ChatService.runAssistantGeneration` (lines
   * 2806-2898 pre-Lot 18):
   *
   *   1. Decide whether to evaluate at all (`modelSupportsReasoning`).
   *   2. Build the eval prompt from the `CHAT_COMMON_PROMPTS.reasoning_effort_eval`
   *      template + the last user message + the conversation excerpt.
   *   3. Stream-call the evaluator model (cheap gemini for gemini,
   *      `gpt-4.1-nano` otherwise) via `MeshDispatchPort.invokeStream`.
   *   4. Validate the produced token; map it to a `ReasoningEffortLabel`.
   *   5. Surface the failure (if any) so the caller can emit the
   *      `reasoning_effort_eval_failed` status event.
   *
   * Crosses the port as an Option A callback (mirrors Lot 16a/16b
   * pattern) rather than as a body in the runtime because the
   * evaluator prompt template lives in `api/src/config/default-chat-system.ts`
   * (the chat prompt registry) which chat-core must not import. The
   * adapter wires the prompt template + mesh dispatch + provider-family
   * decision in one closure.
   *
   * Optional `?`: when undefined (tests that wire a minimal runtime),
   * the wrapper returns `{ shouldEvaluate: false, effortLabel: 'medium',
   * evaluatedBy: 'fallback' }` so chat-core stays usable in unit tests
   * that don't exercise reasoning at all.
   */
  readonly evaluateReasoningEffort?: (
    input: EvaluateReasoningEffortInput,
  ) => Promise<ReasoningEffortEvaluation>;
  /**
   * BR14b Lot 21c — Option A bundle of the api-side per-tool dispatch
   * body. Invoked by `ChatRuntime.consumeToolCalls` for non-local tool
   * calls. Bundles ~10 api-side helpers (`toolService.*`,
   * `todoOrchestrationService.*`, `executeContextDocumentSearch`,
   * `writeChatGenerationTrace`, `parseToolCallArgs`,
   * `estimateContextBudget`, `compactContextIfNeeded`,
   * `markTodoIterationState`). Same Option A pattern as Lot 12/16a/16b.
   * Callback owns the `tool_call_result` event emission + streamSeq
   * advancement via `streamSequencer.allocate`. Optional `?`: when
   * undefined the dispatch short-circuits local tools only (full
   * per-tool migration lands in Lot 21d).
   */
  readonly executeServerTool?: (
    input: ExecuteServerToolInput,
  ) => Promise<ExecuteServerToolResult>;
  /**
   * BR14b Lot 22a-1 — Option A callback wrapping the api-side
   * `getOpenAITransportMode` helper (`api/src/services/provider-connections.ts`).
   * Returns `'codex' | 'token'` (the same union the helper produces).
   * Consumed by `ChatRuntime.initToolLoopState` to derive the
   * `useCodexTransport` boolean (`selectedProviderId === 'openai' &&
   * selectedModel === 'gpt-5.5' && (await callback()) === 'codex'`)
   * without taking a direct dep on the helper's import path.
   *
   * Optional `?`: when undefined (test harness, minimal runtime),
   * the wrapper short-circuits the transport check and defaults
   * `useCodexTransport` to `false` (the legacy fallback for any
   * provider/model pair where the transport-mode lookup is irrelevant).
   */
  readonly resolveOpenAITransportMode?: () => Promise<OpenAITransportMode>;
};

/**
 * Lot 14b — structural mirror of `ChatSessionDocumentItem` from
 * `api/src/services/chat-service.ts`. Carried verbatim so the
 * `getSessionBootstrap` / `getSessionHistory` return payloads stay
 * byte-for-byte identical to the pre-Lot 14b shapes.
 */
export type ChatSessionDocumentItem = {
  id: string;
  context_type: 'chat_session';
  context_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  summary?: string | null;
  summary_lang?: string | null;
  created_at?: Date;
  updated_at?: Date | null;
  job_id?: string | null;
};

/**
 * Lot 14b — structural mirror of `ChatBootstrapStreamEvent` from
 * `api/src/services/chat-service.ts`. Same shape as
 * `ChatHistoryStreamEvent` but with a non-optional `createdAt: Date`
 * (the api adapter SELECTs the `chat_stream_events.createdAt` column).
 */
export type ChatBootstrapStreamEvent = {
  eventType: string;
  data: unknown;
  sequence: number;
  createdAt: Date;
};

/**
 * Lot 14b — options for `ChatRuntime.getSessionBootstrap`. Mirrors the
 * existing `ChatService.getSessionBootstrap` shape verbatim.
 */
export type GetSessionBootstrapOptions = {
  readonly sessionId: string;
  readonly userId: string;
};

export type GetSessionBootstrapResult = {
  readonly messages: ChatMessageWithFeedback[];
  readonly todoRuntime: Record<string, unknown> | null;
  readonly checkpoints: ChatCheckpointSummary[];
  readonly documents: ReadonlyArray<ChatSessionDocumentItem>;
  readonly assistantDetailsByMessageId: Record<string, ChatBootstrapStreamEvent[]>;
};

/**
 * Lot 14b — options for `ChatRuntime.getSessionHistory`. Mirrors the
 * existing `ChatService.getSessionHistory` shape verbatim.
 */
export type GetSessionHistoryOptions = {
  readonly sessionId: string;
  readonly userId: string;
  readonly detailMode?: 'summary' | 'full';
};

export type GetSessionHistoryResult = {
  readonly sessionId: string;
  readonly title: string | null;
  readonly todoRuntime: Record<string, unknown> | null;
  readonly checkpoints: ChatCheckpointSummary[];
  readonly documents: ReadonlyArray<ChatSessionDocumentItem>;
  readonly items: ChatHistoryTimelineItem[];
};

/**
 * Lot 14b — options for `ChatRuntime.getMessageRuntimeDetails`. Mirrors
 * the existing `ChatService.getMessageRuntimeDetails` shape verbatim.
 */
export type GetMessageRuntimeDetailsOptions = {
  readonly messageId: string;
  readonly userId: string;
};

export type GetMessageRuntimeDetailsResult = {
  readonly messageId: string;
  readonly items: ChatHistoryTimelineItem[];
};

/**
 * Options for `ChatRuntime.finalizeAssistantMessageFromStream`. Mirrors
 * the existing `ChatService.finalizeAssistantMessageFromStream` shape
 * verbatim so the chat-service delegate stays a one-liner.
 */
export type FinalizeAssistantOptions = {
  readonly assistantMessageId: string;
  readonly reason?: string;
  readonly fallbackContent?: string;
};

export type FinalizeAssistantResult = {
  readonly content: string;
  readonly reasoning: string | null;
  readonly wroteDone: boolean;
};

/**
 * Summary returned by `ChatRuntime.createCheckpoint` /
 * `listCheckpoints` / projected from `ChatState` snapshots.
 *
 * Pre-Lot 11 the type lived in
 * `api/src/services/chat/postgres-checkpoint-adapter.ts` because the
 * adapter exposed session-aware orchestration. With Lot 11 the
 * orchestration moved into the runtime; the type follows it here so
 * the chat-service facade imports it from chat-core. The shape is
 * unchanged.
 */
export type ChatCheckpointSummary = {
  id: string;
  title: string;
  anchorMessageId: string;
  anchorSequence: number;
  messageCount: number;
  createdAt: string;
};

/**
 * Options for `ChatRuntime.createCheckpoint`. Mirrors the existing
 * `postgresChatCheckpointAdapter.createCheckpointForSession` shape.
 */
export type CreateCheckpointOptions = {
  readonly sessionId: string;
  readonly title?: string | null;
  readonly anchorMessageId?: string | null;
};

/**
 * Options for `ChatRuntime.listCheckpoints`. Mirrors the existing
 * `postgresChatCheckpointAdapter.listCheckpointsForSession` shape.
 */
export type ListCheckpointsOptions = {
  readonly sessionId: string;
  readonly limit?: number;
};

/**
 * Options for `ChatRuntime.restoreCheckpoint`. Mirrors the existing
 * `postgresChatCheckpointAdapter.restoreCheckpointForSession` shape.
 */
export type RestoreCheckpointOptions = {
  readonly sessionId: string;
  readonly checkpointId: string;
};

export type RestoreCheckpointResult = {
  checkpointId: string;
  restoredToSequence: number;
  removedMessages: number;
};

/**
 * Lot 12 — options for `ChatRuntime.retryUserMessage`. Mirrors the
 * existing `ChatService.retryUserMessage` shape verbatim. `providerId`
 * stays a `string | null | undefined` (rather than a typed
 * `MeshProviderId`) because chat-core has no compile-time dependency on
 * `@sentropic/llm-mesh`; the adapter resolves the typed string back into
 * a `ProviderId` via `resolveModelSelection`.
 */
export type RetryUserMessageOptions = {
  readonly messageId: string;
  readonly userId: string;
  readonly providerId?: string | null;
  readonly model?: string | null;
};

export type RetryUserMessageResult = {
  readonly sessionId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly streamId: string;
  readonly providerId: string;
  readonly model: string;
};

/**
 * Lot 12 — `CreateChatMessageInput` structural mirror.
 *
 * Pre-Lot 12 the type lived solely in `api/src/services/chat-service.ts`
 * (it carries the `ChatContextType` union + the `ProviderId` mesh union).
 * For chat-core to migrate `createUserMessageWithAssistantPlaceholder`
 * verbatim, we re-declare the structural slice the runtime actually
 * reads here. All context-typed fields downgrade to `string` because
 * the runtime is contract-agnostic about which strings are valid
 * context types (see `isChatContextType` callback).
 */
export type RuntimeCreateChatMessageInput = {
  readonly userId: string;
  readonly sessionId?: string | null;
  readonly workspaceId?: string | null;
  readonly content: string;
  readonly providerId?: string | null;
  readonly providerApiKey?: string | null;
  readonly model?: string | null;
  readonly primaryContextType?: string | null;
  readonly primaryContextId?: string | null;
  readonly contexts?: ReadonlyArray<{
    readonly contextType: string;
    readonly contextId: string;
  }>;
  readonly sessionTitle?: string | null;
};

export type CreateUserMessageResult = {
  readonly sessionId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly streamId: string;
  readonly providerId: string;
  readonly model: string;
};

/**
 * Lot 15 — options for `ChatRuntime.prepareAssistantRun`. Mirrors the
 * leading slice of `ChatService.runAssistantGeneration` options verbatim
 * (subset that the precheck slice actually reads: userId / sessionId /
 * assistantMessageId / contexts). The remaining `runAssistantGeneration`
 * fields (providerId / model / tools / vscodeCodeAgent / resumeFrom /
 * locale / signal) belong to later slices and stay on the chat-service
 * side until their owning lot.
 */
export type PrepareAssistantRunOptions = {
  readonly userId: string;
  readonly sessionId: string;
  readonly assistantMessageId: string;
  readonly contexts?: ReadonlyArray<{
    readonly contextType: string;
    readonly contextId: string;
  }>;
};

/**
 * Lot 15 — typed context returned by `ChatRuntime.prepareAssistantRun`.
 * Carries the values produced by the precheck slice (session lookup +
 * workspace resolution + workspace access flags + context normalisation
 * + message load + assistant-row precheck + conversation projection +
 * last-user-message extraction). Consumed by the remainder of
 * `runAssistantGeneration` which still lives in `chat-service.ts` for
 * lots 16+.
 */
export type AssistantRunContext = {
  readonly session: ChatSessionRow;
  readonly sessionWorkspaceId: string;
  readonly readOnly: boolean;
  readonly canWrite: boolean;
  readonly currentUserRole: string | null;
  readonly contextsOverride: ReadonlyArray<{
    readonly contextType: string;
    readonly contextId: string;
  }>;
  readonly focusContext: {
    readonly contextType: string;
    readonly contextId: string;
  } | null;
  readonly messages: ReadonlyArray<ChatMessageRow>;
  readonly assistantRow: ChatMessageRow;
  readonly conversation: ReadonlyArray<{
    readonly role: 'user' | 'assistant';
    readonly content: string;
  }>;
  readonly lastUserMessage: string;
};

/**
 * Lot 15 — workspace-access flags resolved for the active user against
 * the active session workspace. Mirrors the inline trio of api-only
 * calls (`isWorkspaceDeleted` + `hasWorkspaceRole` + `getWorkspaceRole`)
 * that lived at the top of `runAssistantGeneration`. Crosses the port
 * as a single Option A callback (same pattern as Lot 10
 * `normalizeVsCodeCodeAgent`, Lot 12 `resolveModelSelection`, Lot 14b
 * `resolveSessionWorkspaceId`) because chat-core must not import
 * `workspace-access`.
 */
export type WorkspaceAccessFlags = {
  readonly readOnly: boolean;
  readonly canWrite: boolean;
  readonly currentUserRole: string | null;
};

/**
 * Lot 16a — options for `ChatRuntime.ensureSessionTitle`. Carries the
 * fields the title-generation block of `runAssistantGeneration` reads
 * verbatim from the `AssistantRunContext` produced by
 * `prepareAssistantRun` (Lot 15). The runtime delegates the actual
 * title-generation + persistence + workspace-event NOTIFY to the
 * `deps.ensureSessionTitle` callback; this method just wires the
 * context fields and short-circuits when the session already has a
 * title or the last user message is empty (mirrors the
 * `if (!session.title && lastUserMessage.trim())` guard inlined in
 * chat-service.ts pre Lot 16).
 */
export type EnsureSessionTitleOptions = {
  readonly session: ChatSessionRow;
  readonly sessionWorkspaceId: string;
  readonly focusContext: {
    readonly contextType: string;
    readonly contextId: string;
  } | null;
  readonly lastUserMessage: string;
};

/**
 * Lot 16b — input for the `buildSystemPrompt` callback (and the
 * `prepareSystemPrompt` runtime method that wraps it). Carries the
 * subset of `AssistantRunContext` (Lot 15) and `runAssistantGeneration`
 * options that the 605-line system-prompt build chain reads:
 *   - `userId`, `sessionId` — used for `listRegisteredTabs(userId)` and
 *     the todo runtime snapshot lookup
 *   - `session`, `sessionWorkspaceId`, `readOnly`, `currentUserRole`,
 *     `contextsOverride`, `focusContext`, `lastUserMessage` — mirror the
 *     `AssistantRunContext` fields consumed by the block
 *   - `requestedTools` — caller toggle (web_search, plan, etc.)
 *   - `localToolDefinitions` — caller-provided local tool definitions
 *   - `vscodeCodeAgent` — raw VsCode payload (normalized inside the
 *     callback via the existing chat-service helper)
 */
export type BuildSystemPromptInput = {
  readonly userId: string;
  readonly sessionId: string;
  readonly session: ChatSessionRow;
  readonly sessionWorkspaceId: string;
  readonly readOnly: boolean;
  readonly currentUserRole: string | null;
  readonly contextsOverride: ReadonlyArray<{
    readonly contextType: string;
    readonly contextId: string;
  }>;
  readonly focusContext: {
    readonly contextType: string;
    readonly contextId: string;
  } | null;
  readonly lastUserMessage: string;
  readonly requestedTools: ReadonlyArray<string>;
  readonly localToolDefinitions?: ReadonlyArray<unknown>;
  readonly vscodeCodeAgent?: unknown;
};

/**
 * Lot 16b — typed result of the `buildSystemPrompt` callback (and the
 * `prepareSystemPrompt` runtime method that wraps it). Carries exactly
 * the 16 fields that the remainder of `runAssistantGeneration` reads
 * downstream of the system-prompt build block (lines 2541+ post Lot
 * 16b). Other intermediate locals (e.g. `documentsBlock`,
 * `wsTypeToolNames`, `effectiveRequestedTools`, `requestedTools`,
 * `todoToolRequested`, `hasDocuments`, `hasCommentContexts`,
 * `documentsToolName`, `contextLabel`) stay strictly internal to the
 * builder — they are consumed only inside the migrated block to compose
 * the result.
 *
 * Field types intentionally use loose readonly arrays / unknowns at the
 * port boundary because chat-core must not depend on `OpenAI` typings,
 * `ChatContextType`, `CommentContextType`, or the chat-service-side
 * tool catalog union. The api-side delegate narrows back to the
 * concrete types at the destructure boundary in `runAssistantGeneration`.
 */
export type BuildSystemPromptResult = {
  readonly systemPrompt: string;
  readonly tools: ReadonlyArray<unknown> | undefined;
  readonly localTools: ReadonlyArray<unknown>;
  readonly localToolNames: ReadonlySet<string>;
  readonly allowedByType: {
    readonly organization: ReadonlySet<string>;
    readonly folder: ReadonlySet<string>;
    readonly usecase: ReadonlySet<string>;
    readonly executive_summary: ReadonlySet<string>;
  };
  readonly allowedFolderIds: ReadonlySet<string>;
  readonly allowedDocContexts: ReadonlyArray<{
    readonly contextType: string;
    readonly contextId: string;
  }>;
  readonly allowedCommentContexts: ReadonlyArray<{
    readonly contextType: string;
    readonly contextId: string;
  }>;
  readonly hasContextType: (type: string) => boolean;
  readonly primaryContextType: string | null;
  readonly primaryContextId: string | null;
  readonly vscodeCodeAgentPayload:
    | NormalizedVsCodeCodeAgentRuntimePayload
    | null;
  readonly enforceTodoUpdateMode: boolean;
  readonly todoStructuralMutationIntent: boolean;
  readonly todoProgressionFocusMode: boolean;
  readonly hasActiveSessionTodo: boolean;
};

/**
 * Lot 16b — options for `ChatRuntime.prepareSystemPrompt`. Carries the
 * subset of caller-side fields that come from `runAssistantGeneration`
 * options (not from the precheck `AssistantRunContext`). The wrapper
 * combines this with the `AssistantRunContext` produced by Lot 15 to
 * form the full `BuildSystemPromptInput`.
 */
export type PrepareSystemPromptOptions = {
  readonly requestedTools: ReadonlyArray<string>;
  readonly localToolDefinitions?: ReadonlyArray<unknown>;
  readonly vscodeCodeAgent?: unknown;
};

/**
 * BR14b Lot 18 — reasoning-effort label union. Mirrors the literal union
 * persisted in the `status:reasoning_effort_selected` stream event and
 * consumed by `MeshStreamRequest.reasoningEffort`. Kept as a closed union
 * (rather than a `string`) so callers can narrow safely without re-doing
 * the token validation that the evaluator performs once.
 */
export type ReasoningEffortLabel =
  | 'none'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

/**
 * BR14b Lot 18 — input carried into `ChatRuntime.evaluateReasoningEffort`.
 * Mirrors the inline block previously embedded in
 * `ChatService.runAssistantGeneration` (chat-service.ts lines 2806-2898
 * pre-Lot 18). `conversation` reuses the same `{role, content}` projection
 * built by the Lot 15 `prepareAssistantRun` slice; chat-core stays role-
 * agnostic and the evaluator only narrows for the trailing user message.
 *
 * `selectedProviderId` / `selectedModel` are the already-resolved values
 * from `resolveModelSelection` (Lot 12/17) — the evaluator chooses the
 * evaluator-side model from the same provider family (gemini → gemini
 * cheap model, otherwise OpenAI gpt-4.1-nano).
 */
export interface EvaluateReasoningEffortInput {
  readonly userId: string;
  readonly workspaceId: string | null;
  readonly selectedProviderId: string;
  readonly selectedModel: string;
  readonly conversation: ReadonlyArray<{
    readonly role: string;
    readonly content: string;
  }>;
  readonly signal?: AbortSignal;
  /**
   * BR14b Lot 20 — stream id where the runtime should append the two
   * status events that previously lived caller-side
   * (`reasoning_effort_eval_failed` + `reasoning_effort_selected`).
   * The runtime allocates sequence numbers via `deps.streamSequencer`
   * and appends via `deps.streamBuffer.append`. Required (no longer
   * optional) so the caller no longer needs to bracket the call with
   * `writeStreamEvent` + `streamSeq +=` mutations.
   */
  readonly streamId: string;
}

/**
 * BR14b Lot 18 — outcome of the reasoning-effort evaluation.
 *
 * BR14b Lot 20 — the two stream events that previously bracketed the
 * inline block caller-side (`reasoning_effort_eval_failed` +
 * `reasoning_effort_selected`) are now emitted by the runtime itself
 * via `deps.streamSequencer.allocate(streamId)` +
 * `deps.streamBuffer.append(streamId, 'status', ...)`. The result struct
 * still surfaces `failure` and `evaluatedBy` so callers that want to
 * log additional diagnostic traces (e.g. `console.error`) can do so.
 *
 *   - `shouldEvaluate`: `false` when the selected model has
 *     `reasoningTier === 'none'` (the legacy code skipped the entire
 *     block); `true` otherwise.
 *   - `effortLabel`: the validated label the caller should request from
 *     the mesh. Defaults to `'medium'` on fallback (legacy default).
 *   - `effortForMessage`: present only when the evaluator produced a
 *     valid token (mirrors the pre-Lot 18 `reasoningEffortForThisMessage`
 *     local that downstream code reads when deciding whether to attach
 *     the effort hint to the assistant message persisted record).
 *   - `evaluatedBy`: same `reasoningEffortBy` legacy value
 *     (`evaluatorModel`, `'fallback'`, or `'non-gpt-5'`).
 *   - `failure`: present only when the evaluator threw or returned an
 *     invalid token; the caller emits the
 *     `reasoning_effort_eval_failed` status event using
 *     `failure.message` verbatim.
 */
export interface ReasoningEffortEvaluation {
  readonly shouldEvaluate: boolean;
  readonly effortLabel: ReasoningEffortLabel;
  readonly effortForMessage?: ReasoningEffortLabel;
  readonly evaluatedBy: string;
  /**
   * Evaluator-side model name (e.g. `'gpt-4.1-nano'` or
   * `'gemini-3.1-flash-lite-preview'`). Populated whenever
   * `shouldEvaluate=true` regardless of success/failure — exposed so the
   * caller can emit the same console.error trace shape that the legacy
   * inline code produced (`{assistantMessageId, sessionId, model,
   * evaluatorModel, error}`). `null` when `shouldEvaluate=false`.
   */
  readonly evaluatorModel: string | null;
  readonly failure?: { readonly message: string };
}

/**
 * BR14b Lot 22a-1 — OpenAI transport mode resolved by the api-side
 * `getOpenAITransportMode` helper (`api/src/services/provider-connections.ts`).
 * Mirrors that helper's `Promise<'codex' | 'token'>` return type verbatim
 * so the runtime callback contract stays byte-identical. Surfaced as a
 * dedicated union so chat-core can stay agnostic of the helper's import
 * path while typing the optional `resolveOpenAITransportMode` dep below.
 */
export type OpenAITransportMode = 'codex' | 'token';

/**
 * BR14b Lot 22a-1 — input carried into `ChatRuntime.initToolLoopState`.
 * Bundles the four caller-side inputs the pre-loop init slice
 * (chat-service.ts lines 3084-3157 pre-Lot 22a-1) reads to compose:
 *   1. `resolveModelSelection` (Lot 12/17 callback) — for the resolved
 *      provider + model pair driving every downstream mesh call.
 *   2. The `useCodexTransport` boolean — derived from the resolved
 *      selection + `deps.resolveOpenAITransportMode` callback. Mutated
 *      onto `loopState.useCodexTransport` verbatim (mirrors the inline
 *      `loopState.useCodexTransport = useCodexTransport` write at line
 *      3109 pre-Lot 22a-1).
 *   3. `evaluateReasoningEffort` (Lot 18/20 callback) — for the
 *      reasoning effort label + the two status events the runtime emits
 *      internally.
 *   4. The post-call `streamSeq` cursor re-sync via
 *      `peekStreamSequence + 1` (mirrors the inline re-sync at line
 *      3156-3157 pre-Lot 22a-1).
 *
 * The `assistantRowModel` fallback mirrors the inline
 * `options.model || assistantRow.model` expression (the caller composes
 * it because chat-core stays agnostic of the assistant-row precheck
 * shape produced by `prepareAssistantRun`).
 */
export interface InitToolLoopStateInput {
  readonly userId: string;
  readonly providerId?: string | null;
  readonly model?: string | null;
  readonly assistantRowModel: string;
  readonly assistantMessageId: string;
  readonly sessionWorkspaceId: string | null;
  readonly conversation: ReadonlyArray<{
    readonly role: 'user' | 'assistant';
    readonly content: string;
  }>;
  readonly signal?: AbortSignal;
  readonly loopState: AssistantRunLoopState;
}

/**
 * BR14b Lot 22a-1 — result of `ChatRuntime.initToolLoopState`. Carries
 * the four post-init values the chat-service caller needs to thread
 * through the remainder of `runAssistantGeneration` (the pass1 tool
 * loop + the pass2 fallback):
 *   - `selectedProviderId` / `selectedModel` — the resolved pair from
 *     `resolveModelSelection`. Same `string` opacity as
 *     `EvaluateReasoningEffortInput.selectedProviderId`; the caller
 *     casts back to `ProviderId` mirroring the Lot 17 pattern.
 *   - `useCodexTransport` — already mirrored onto
 *     `loopState.useCodexTransport`; returned for the caller's local
 *     `const useCodexTransport` binding so the rest of
 *     `runAssistantGeneration` keeps using the same identifier.
 *   - `reasoning` — the full `ReasoningEffortEvaluation` (callback's
 *     return value verbatim). Returned so the caller can emit the
 *     legacy `console.error('[chat] reasoning_effort_eval_failed', ...)`
 *     trace on `failure` — that trace carries `sessionId` which
 *     chat-core stays agnostic of.
 *   - `reasoningEffortForThisMessage` — convenience alias for
 *     `reasoning.effortForMessage` (the caller's pre-Lot 22a-1 local).
 *   - `streamSeq` — re-synced via `peekStreamSequence + 1` after the
 *     two status events `evaluateReasoningEffort` may have appended
 *     internally (mirrors the inline re-sync at line 3156-3157
 *     pre-Lot 22a-1).
 */
export interface InitToolLoopStateResult {
  readonly selectedProviderId: string;
  readonly selectedModel: string;
  readonly useCodexTransport: boolean;
  readonly reasoning: ReasoningEffortEvaluation;
  readonly reasoningEffortForThisMessage: ReasoningEffortLabel | undefined;
  readonly streamSeq: number;
}

/**
 * Options for `ChatRuntime.acceptLocalToolResult`. Mirrors the existing
 * `ChatService.acceptLocalToolResult` shape verbatim.
 */
export type AcceptLocalToolResultOptions = {
  readonly assistantMessageId: string;
  readonly toolCallId: string;
  readonly result: unknown;
};

export type AcceptLocalToolResultResponse = {
  readyToResume: boolean;
  waitingForToolCallIds: string[];
  localToolDefinitions: LocalToolDefinitionInput[];
  vscodeCodeAgent?: NormalizedVsCodeCodeAgentRuntimePayload | null;
  resumeFrom?: ChatResumeFromToolOutputs;
};

/**
 * BR14b Lot 21a — chat-core mirror of the api-side `ChatRuntimeMessage`
 * union (`chat-service.ts` line 309-311). Used as the entry type for
 * the tool-loop `currentMessages` cursor lifted into
 * `AssistantRunLoopState`. The runtime stays role-agnostic and the
 * api-side delegate narrows to the concrete provider message shapes
 * (OpenAI Responses API) at the call boundary.
 */
export type AssistantRunLoopMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'tool'; content: string; tool_call_id: string };

/**
 * BR14b Lot 21a — pending tool-call accumulator. Mirrors the
 * `toolCalls` array tracked in the chat-service.ts tool loop pre-Lot
 * 21a. `id` is the provider-side `tool_call_id`; `name` and `args`
 * are streamed deltas concatenated across `tool_call_start` /
 * `tool_call_delta` events.
 */
export type AssistantRunLoopPendingToolCall = {
  id: string;
  name: string;
  args: string;
};

/**
 * BR14b Lot 21a — executed tool ledger. Mirrors the `executedTools`
 * array tracked in the chat-service.ts tool loop pre-Lot 21a (each
 * entry records the call id + tool name + parsed args + tool result
 * for downstream persistence + assistant-message audit trail).
 */
export type AssistantRunLoopExecutedTool = {
  toolCallId: string;
  name: string;
  args: unknown;
  result: unknown;
};

/**
 * BR14b Lot 21a — loop-local state value object initialized at the
 * start of `ChatService.runAssistantGeneration` (chat-service.ts
 * lines 2896-2934 + 3001 pre-Lot 21a). Carries every mutable counter,
 * accumulator, and flag the tool-loop body reads or writes across
 * iterations. Returned by `ChatRuntime.beginAssistantRunLoop` and
 * threaded through the loop body as a single struct so the loop
 * shape stays migration-friendly for Lot 21b (mesh stream consumer)
 * and onward.
 *
 * Fields are intentionally mutable — the loop mutates them in place
 * (e.g. `loopState.contentParts.length = 0` at iteration start,
 * `loopState.iteration++`, `loopState.maxIterations = ...`) — so this
 * type is a struct of public lvalues, not a frozen snapshot. The
 * runtime owns the **initialization** of the fields; the loop body
 * still owns the **mutation**. Future lots will progressively migrate
 * the mutators into runtime methods that take the state by reference.
 *
 * Field-by-field correspondence with the inline declarations
 * pre-Lot 21a:
 *   - `streamSeq` ← `await getNextSequence(assistantMessageId)`
 *   - `lastObservedStreamSequence` ← `Math.max(streamSeq - 1, 0)`
 *   - `contentParts`/`reasoningParts` ← `[]`
 *   - `lastErrorMessage` ← `null`
 *   - `executedTools`/`toolCalls` ← `[]`
 *   - `currentMessages` ← `[{system}, ...conversation]`
 *   - `maxIterations` ← `BASE_MAX_ITERATIONS` (10)
 *   - `todoAutonomousExtensionEnabled` ← `Boolean(enforceTodoUpdateMode &&
 *       todoProgressionFocusMode)`
 *   - `todoContinuationActive` ← `Boolean(todoAutonomousExtensionEnabled &&
 *       hasActiveSessionTodo)`
 *   - `todoAwaitingUserInput` ← `false`
 *   - `iteration` ← `0`
 *   - `previousResponseId` ← `resumeFrom?.previousResponseId ?? null`
 *   - `pendingResponsesRawInput` ← projected from `resumeFrom?.toolOutputs`
 *   - `steerHistoryMessages` ← `[]`
 *   - `steerReasoningReplay` ← `''`
 *   - `lastBudgetAnnouncedPct` ← `-1`
 *   - `contextBudgetReplanAttempts` ← `0`
 *   - `continueGenerationLoop` ← `true`
 */
export interface AssistantRunLoopState {
  streamSeq: number;
  lastObservedStreamSequence: number;
  contentParts: string[];
  reasoningParts: string[];
  lastErrorMessage: string | null;
  executedTools: AssistantRunLoopExecutedTool[];
  toolCalls: AssistantRunLoopPendingToolCall[];
  currentMessages: AssistantRunLoopMessage[];
  maxIterations: number;
  todoAutonomousExtensionEnabled: boolean;
  todoContinuationActive: boolean;
  todoAwaitingUserInput: boolean;
  iteration: number;
  previousResponseId: string | null;
  pendingResponsesRawInput: unknown[] | null;
  steerHistoryMessages: string[];
  steerReasoningReplay: string;
  lastBudgetAnnouncedPct: number;
  contextBudgetReplanAttempts: number;
  continueGenerationLoop: boolean;
  /**
   * BR14b Lot 21c — surfaces the `useCodexTransport` boolean computed by
   * chat-service (`selectedProviderId === 'openai' && selectedModel ===
   * 'gpt-5.5' && (await getOpenAITransportMode()) === 'codex'`) on the
   * loop state so the upcoming `consumeToolCalls` migration can read it
   * without taking it as a per-call input. Caller updates it after
   * `beginAssistantRunLoop` (the value depends on the resolved model
   * selection performed AFTER loop-state init in the current chat-service
   * flow). Used by the tool-dispatch path to gate the
   * `needsExplicitToolReplay` rawInput rebuild + the `previousResponseId
   * = null` clear when the transport is codex.
   */
  useCodexTransport: boolean;
}

/**
 * BR14b Lot 21a — options for `ChatRuntime.beginAssistantRunLoop`.
 * Mirrors the subset of caller-side values consumed by the loop-state
 * initialization block (chat-service.ts lines 2896-2934 + 3001 pre-Lot
 * 21a). The caller composes these from `runAssistantGeneration`
 * options + the `AssistantRunContext` + `BuildSystemPromptResult`
 * produced upstream.
 *
 *   - `assistantMessageId` — used as the stream id for the initial
 *     `streamBuffer.getNextSequence` allocation.
 *   - `systemPrompt` — prepended to `currentMessages` as the first
 *     role:'system' entry.
 *   - `conversation` — the user/assistant projection produced by Lot
 *     15 `prepareAssistantRun`.
 *   - `resumeFrom` — optional resume payload (previous response id +
 *     buffered tool outputs); projected into `previousResponseId` +
 *     `pendingResponsesRawInput` verbatim.
 *   - `enforceTodoUpdateMode` / `todoProgressionFocusMode` /
 *     `hasActiveSessionTodo` — three booleans from
 *     `BuildSystemPromptResult` that drive `todoAutonomousExtensionEnabled`
 *     and `todoContinuationActive`.
 *   - `baseMaxIterations` — the `BASE_MAX_ITERATIONS` constant (10
 *     pre-Lot 21a). Surfaced as input so chat-core stays free of
 *     api-side tuning constants.
 */
export interface BeginAssistantRunLoopInput {
  readonly assistantMessageId: string;
  readonly systemPrompt: string;
  readonly conversation: ReadonlyArray<{
    readonly role: 'user' | 'assistant';
    readonly content: string;
  }>;
  readonly resumeFrom?: ChatResumeFromToolOutputs;
  readonly enforceTodoUpdateMode: boolean;
  readonly todoProgressionFocusMode: boolean;
  readonly hasActiveSessionTodo: boolean;
  readonly baseMaxIterations: number;
  /**
   * BR14b Lot 21c — optional initial value for
   * `AssistantRunLoopState.useCodexTransport`. Defaults to `false` when
   * undefined; the chat-service caller currently resolves the boolean
   * AFTER loop-state init (depends on the model selection performed
   * later in `runAssistantGeneration`) so it overwrites the field
   * directly post-init. Surfaced on the input so future callers that
   * know the transport up-front can seed it without the post-init
   * mutation.
   */
  readonly useCodexTransport?: boolean;
}

/**
 * BR14b Lot 21b — terminal reason returned by
 * `ChatRuntime.consumeAssistantStream`. Mirrors the four control-flow
 * outcomes the inline mesh stream consumer used to drive
 * (chat-service.ts lines 3203-3384 pre-Lot 21b):
 *
 *   - `'normal'`        — stream reached `done` cleanly; caller proceeds
 *                          to tool dispatch (or finalization if no tool
 *                          calls were accumulated).
 *   - `'retry_without_previous_response'`
 *                       — mesh rejected the call with a
 *                          previous-response-not-found error; caller must
 *                          clear `previousResponseId` +
 *                          `pendingResponsesRawInput` and restart the
 *                          iteration.
 *   - `'steer_interrupted'`
 *                       — a steer message arrived mid-stream; the
 *                          consumer aborted early and the caller must
 *                          merge the steer batch into `currentMessages`
 *                          and restart the iteration.
 *   - `'error'`         — the mesh emitted an `error` event (already
 *                          forwarded to the stream); caller may continue
 *                          its post-loop error handling (the legacy
 *                          inline body did not surface a dedicated
 *                          enum value — the catch path threw — but the
 *                          runtime captures it explicitly so future
 *                          callers can branch without re-parsing the
 *                          error string).
 */
export type ConsumeAssistantStreamDoneReason =
  | 'normal'
  | 'retry_without_previous_response'
  | 'steer_interrupted'
  | 'error';

/**
 * BR14b Lot 21b — request payload passed to
 * `ChatRuntime.consumeAssistantStream`. Mirrors the per-iteration mesh
 * invocation contract previously inlined in
 * `chat-service.ts` pre-Lot 21b (the literal object passed to
 * `callLLMStream` at line 3205). Fields stay opaque (`unknown`,
 * `ReadonlyArray<unknown>`) because chat-core forwards them to the
 * mesh adapter as-is (same convention as `MeshStreamRequest`).
 *
 *   - `providerId` / `model` / `credential` / `userId` / `workspaceId`
 *     — provider routing inputs.
 *   - `messages` — the current `currentMessages` array AFTER any
 *     `applySteerInterruptionPrompt` mutation done by the caller.
 *   - `tools` — server-side tool catalog (may be undefined for pass2).
 *   - `toolChoice` — `'auto' | 'required' | 'none'`. The legacy inline
 *     pass1 uses `pass1ToolChoice` computed by the caller.
 *   - `reasoningSummary` / `reasoningEffort` — provider reasoning
 *     controls. Caller passes the validated label from
 *     `evaluateReasoningEffort`.
 *   - `previousResponseId` / `rawInput` — Responses-API continuation
 *     handles. `null` is accepted (legacy code passed `?? undefined`).
 *   - `signal` — abort signal forwarded to the mesh.
 */
export interface ConsumeAssistantStreamRequest {
  readonly providerId?: string;
  readonly model?: string;
  readonly credential?: string;
  readonly userId?: string;
  readonly workspaceId?: string;
  readonly messages: ReadonlyArray<unknown>;
  readonly tools?: ReadonlyArray<unknown>;
  readonly toolChoice?: 'auto' | 'required' | 'none';
  readonly reasoningSummary?: 'auto' | 'concise' | 'detailed';
  readonly reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
  readonly previousResponseId?: string | null;
  readonly rawInput?: ReadonlyArray<unknown> | null;
  readonly signal?: AbortSignal;
}

/**
 * BR14b Lot 21b — input to `ChatRuntime.consumeAssistantStream`. The
 * runtime mutates `loopState` in place so the caller's destructured
 * locals (`contentParts`, `reasoningParts`, `toolCalls`, etc.) observe
 * the streamed deltas immediately upon return — same shape the inline
 * loop body produced pre-Lot 21b.
 *
 *   - `streamId` — used to allocate sequences via
 *     `deps.streamSequencer.allocate` and to persist events via
 *     `deps.streamBuffer.append`. Equal to `assistantMessageId` in
 *     practice (the chat-service caller passes it).
 *   - `loopState` — mutable run-loop value carrier produced by
 *     `beginAssistantRunLoop`. The runtime mutates these fields:
 *       * `contentParts.push(delta)` on `content_delta`
 *       * `reasoningParts.push(delta)` + `steerReasoningReplay` cursor
 *         on `reasoning_delta`
 *       * `toolCalls` slot upsert on `tool_call_start` / `_delta`
 *       * `previousResponseId` reassignment on `status.response_id`
 *       * `lastErrorMessage` capture on `error`
 *       * `lastObservedStreamSequence` advance on steer poll
 *   - `request` — mesh request payload (see `ConsumeAssistantStreamRequest`).
 */
export interface ConsumeAssistantStreamInput {
  readonly streamId: string;
  readonly loopState: AssistantRunLoopState;
  readonly request: ConsumeAssistantStreamRequest;
}

/**
 * BR14b Lot 21b — return shape of `ChatRuntime.consumeAssistantStream`.
 * Reports the terminal reason + the captured steer batch (when the
 * stream was interrupted). The mutable state is on `loopState` (passed
 * by reference), so most fields the inline body produced are observed
 * via the input — only the fields that are NOT on `loopState` surface
 * here.
 *
 *   - `doneReason` — see `ConsumeAssistantStreamDoneReason`.
 *   - `steerInterruptionBatch` — populated when `doneReason ===
 *     'steer_interrupted'`. Empty when other reasons. The caller
 *     consumes this to mutate `steerHistoryMessages` +
 *     `currentMessages` for the next iteration.
 *   - `errorMessage` — populated when the consumer captured an
 *     `error` event (mirrors `lastErrorMessage` on the state) or when
 *     the catch branch threw because the error wasn't a
 *     previous-response-not-found match (in which case the runtime
 *     re-throws, same as the inline body — `errorMessage` then
 *     remains `undefined`).
 */
export interface ConsumeAssistantStreamResult {
  readonly doneReason: ConsumeAssistantStreamDoneReason;
  readonly steerInterruptionBatch: ReadonlyArray<string>;
  readonly errorMessage?: string;
}

/**
 * BR14b Lot 21c — input passed to the `executeServerTool` callback
 * (Option A bundle, mirrors Lot 12/16a/16b pattern) for every non-local
 * tool call dispatched by `ChatRuntime.consumeToolCalls`. Callback owns
 * the per-tool `tool_call_result` event emission (each branch has its
 * own payload shape) and advances the shared `streamSeq` cursor via
 * `deps.streamSequencer.allocate(streamId)`. Fields opaque on the
 * boundary (same convention as `ConsumeAssistantStreamRequest`).
 * Surfaced for the upcoming Lot 21d migration of the inline per-tool
 * body (~1622 lines, ~30 tool-name branches, 42 streamSeq sites).
 */
export interface ExecuteServerToolInput {
  readonly userId: string;
  readonly sessionId: string;
  readonly assistantMessageId: string;
  readonly workspaceId: string | null;
  readonly toolCall: {
    readonly id: string;
    readonly name: string;
    readonly args: string;
  };
  readonly streamSeq: number;
  readonly currentMessages: ReadonlyArray<unknown>;
  readonly tools: ReadonlyArray<unknown> | null;
  readonly responseToolOutputs: ReadonlyArray<unknown>;
  readonly providerId: string;
  readonly modelId: string;
  readonly enforceTodoUpdateMode: boolean;
  readonly todoAutonomousExtensionEnabled: boolean;
  readonly contextBudgetReplanAttempts: number;
  readonly readOnly: boolean;
  readonly signal?: AbortSignal;
}

/**
 * BR14b Lot 21c — return shape of the `executeServerTool` callback.
 * Mirrors the structured outputs the inline per-tool body accumulates:
 *   - `output` — raw tool result (any shape); pushed into `executedTools.result`.
 *   - `outputForModel` — `JSON.stringify(result)` pushed into both
 *     `toolResults.content` and `responseToolOutputs.output`.
 *   - `success` / `errorMessage` — `false` + error message when the
 *     inline catch wrapped the error into `{status:'error', error}`.
 *   - `todoStateUpdate` — forwarded to `markTodoIterationState` when
 *     `tool === 'plan'` AND `todoAutonomousExtensionEnabled` is true
 *     (covers the 3 inline call sites + the catch path).
 *   - `contextBudgetReplan` — `true` when the gate triggered the
 *     `continue` branch; runtime skips per-tool accumulators on this
 *     iteration. Surfaced for Lot 21e gate migration.
 */
export interface ExecuteServerToolResult {
  readonly output: unknown;
  readonly outputForModel: string;
  readonly success: boolean;
  readonly errorMessage?: string;
  readonly todoStateUpdate?: unknown;
  readonly contextBudgetReplan?: boolean;
}

/**
 * BR14b Lot 21c / 21e-2 — input to `ChatRuntime.consumeToolCalls`.
 *
 * Lot 21c landed the orchestration shell (empty-toolCalls short-circuit
 * + local-tool branch). Lot 21e-2 extends the method to own the full
 * per-tool dispatch loop body: context-budget gate pre-compute +
 * gate invocation + per-tool `executeServerTool` dispatch + try/catch
 * wrapper + accumulator pushes + `todoErrorCall` handling.
 *
 * Fields fall into four groups:
 *
 *   1. Per-call identity / config (Lot 21c): `streamId`, `loopState`,
 *      `localToolNames`, `sessionId`, `userId`, `workspaceId`,
 *      `providerId`, `modelId`, `tools`, `enforceTodoUpdateMode`,
 *      `readOnly`, `signal`.
 *
 *   2. Context-budget gate (Lot 21e-2): the counter, the api-side
 *      constants (`maxReplanAttempts`, `softZoneCode`, `hardZoneCode`),
 *      and the api-side helpers (`estimateContextBudget`,
 *      `estimateToolResultProjectionChars`, `writeContextBudgetStatus`,
 *      `resolveBudgetZone`, `estimateTokenCountFromChars`,
 *      `compactContextIfNeeded`) that the caller previously invoked
 *      inline before calling `applyContextBudgetGate`. The runtime
 *      pre-computes `projectedResultChars` + `preToolBudget`, emits the
 *      `pre_tool` status, then forwards to its own
 *      `applyContextBudgetGate` method.
 *
 *   3. Catch-block (Lot 21e-2): `markTodoIterationState` is invoked on
 *      the error path when `toolCall.name === 'plan'` AND
 *      `todoAutonomousExtensionEnabled === true` (mirrors the inline
 *      `todoErrorCall` block at chat-service.ts line 3712-3715
 *      pre-Lot 21e-2).
 *
 *   4. `executeServerTool` bundle builder (Lot 21e-2): caller-supplied
 *      factory that builds the chat-service-LOCAL bundle (33 fields
 *      including closures + captured locals) cast to the chat-core
 *      opaque `ExecuteServerToolInput`. Same Option A pattern as
 *      Lot 21d-3: the chat-core boundary stays narrow; the bundle is
 *      forwarded verbatim to `deps.executeServerTool` via the
 *      `runtime.executeServerTool` facade.
 *
 *   5. Outer state snapshot (Lot 21e-2): `currentMessages` is read by
 *      the gate pre-compute (`estimateContextBudget` projects token
 *      occupancy from messages + tools + rawInput). The caller passes
 *      the current snapshot at loop entry; the gate's `compactContextIfNeeded`
 *      closure mutates it caller-side when the hard-zone branch fires.
 */
export interface ConsumeToolCallsInput {
  // Group 1 — per-call identity / config (Lot 21c)
  readonly streamId: string;
  readonly loopState: AssistantRunLoopState;
  readonly localToolNames: ReadonlySet<string>;
  readonly sessionId: string;
  readonly userId: string;
  readonly workspaceId: string | null;
  readonly providerId: string;
  readonly modelId: string;
  readonly tools: ReadonlyArray<unknown> | null;
  readonly enforceTodoUpdateMode: boolean;
  readonly readOnly: boolean;
  readonly signal?: AbortSignal;
  // Group 2 — context-budget gate (Lot 21e-2)
  readonly contextBudgetReplanAttempts: number;
  readonly maxReplanAttempts: number;
  readonly softZoneCode: string;
  readonly hardZoneCode: string;
  readonly estimateContextBudget: (input: {
    readonly messages: ReadonlyArray<unknown>;
    readonly tools: ReadonlyArray<unknown> | null;
    readonly rawInput: ReadonlyArray<unknown>;
    readonly providerId: string;
    readonly modelId: string;
  }) => ContextBudgetSnapshot;
  readonly estimateToolResultProjectionChars: (
    toolName: string,
    args: Record<string, unknown>,
  ) => number;
  readonly writeContextBudgetStatus: (
    phase: 'pre_tool',
    snapshot: ContextBudgetSnapshot,
    meta: { readonly tool_name: string },
  ) => Promise<void>;
  readonly resolveBudgetZone: (occupancyPct: number) => ContextBudgetZone;
  readonly estimateTokenCountFromChars: (charCount: number) => number;
  readonly compactContextIfNeeded: (
    reason: 'pre_tool_hard_threshold',
    snapshot: ContextBudgetSnapshot,
  ) => Promise<ContextBudgetSnapshot>;
  // Group 3 — catch-block (Lot 21e-2)
  readonly markTodoIterationState: (rawResult: unknown) => void;
  readonly todoAutonomousExtensionEnabled: boolean;
  // Group 4 — executeServerTool bundle builder (Lot 21e-2)
  readonly buildExecuteServerToolInput: (ctx: {
    readonly toolCall: { readonly id: string; readonly name: string; readonly args: string };
    readonly args: unknown;
    readonly todoOperation: string | null;
    readonly streamSeq: number;
    readonly currentMessages: ReadonlyArray<unknown>;
    readonly responseToolOutputs: ReadonlyArray<unknown>;
    readonly executedTools: ReadonlyArray<AssistantRunLoopExecutedTool>;
  }) => ExecuteServerToolInput;
  // Group 5 — outer state snapshot (Lot 21e-2)
  readonly currentMessages: ReadonlyArray<unknown>;
}

/**
 * BR14b Lot 21c / 21e-2 — return shape of `ChatRuntime.consumeToolCalls`.
 *
 * Lot 21c landed the empty `toolResults` / `responseToolOutputs` /
 * `executedTools` arrays. Lot 21e-2 populates them with the
 * per-iteration accumulator deltas the caller must merge into its
 * outer state. Two cursors are also returned so the caller stays in
 * sync with the runtime: `streamSeq` (advanced by every event emitted
 * across the iteration loop) and `contextBudgetReplanAttempts`
 * (advanced or reset by `applyContextBudgetGate` invocations).
 *
 *   - `toolResults` — `role:'tool'` messages (one per tool call, both
 *     success and error branches).
 *   - `responseToolOutputs` — `function_call_output` rawInput entries
 *     (one per tool call).
 *   - `pendingLocalToolCalls` — local-tool short-circuit queue
 *     (consumed by the caller's post-loop
 *     `awaiting_local_tool_results` status emission).
 *   - `executedTools` — trace accumulator (one row per tool call).
 *   - `shouldBreakLoop` — `true` when the empty-toolCalls short-circuit
 *     fired; the caller breaks the outer iteration loop.
 *   - `streamSeq` — advanced cursor (mirrors the inline
 *     `streamSeq = …` mutations across the iteration).
 *   - `contextBudgetReplanAttempts` — advanced or reset counter
 *     (mirrors the inline `+= 1` / `= 0` mutations driven by
 *     `applyContextBudgetGate`).
 */
export interface ConsumeToolCallsResult {
  readonly toolResults: ReadonlyArray<{
    readonly role: 'tool';
    readonly content: string;
    readonly tool_call_id: string;
  }>;
  readonly responseToolOutputs: ReadonlyArray<{
    readonly type: 'function_call_output';
    readonly call_id: string;
    readonly output: string;
  }>;
  readonly pendingLocalToolCalls: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly args: unknown;
  }>;
  readonly executedTools: ReadonlyArray<AssistantRunLoopExecutedTool>;
  readonly shouldBreakLoop: boolean;
  readonly streamSeq: number;
  readonly contextBudgetReplanAttempts: number;
}

/**
 * BR14b Lot 21e-1 — input to `ChatRuntime.applyContextBudgetGate`.
 *
 * Mirrors verbatim the captured locals consumed by the inline gate at
 * `chat-service.ts` lines 3534-3636 (post-Lot 21d-3): the parsed `args`,
 * the pre-computed `preToolBudget` snapshot, the pre-computed
 * `projectedResultChars`, the running `streamSeq` + `contextBudgetReplanAttempts`
 * cursors, and three pure helpers + one compaction callback bound on
 * the caller side. The caller pre-computes `preToolBudget` and
 * `projectedResultChars` because the helpers `estimateContextBudget`
 * and `estimateToolResultProjectionChars` live api-side (they consume
 * `MODEL_CONTEXT_BUDGETS` and the api-defined per-tool projection
 * heuristics — chat-core must not import them per SPEC §5).
 *
 *   - `resolveBudgetZone` — pure projection of `occupancyPct` to the
 *     `ContextBudgetZone` union (api-side because the thresholds live
 *     api-side as `CONTEXT_BUDGET_SOFT_THRESHOLD` / `CONTEXT_BUDGET_HARD_THRESHOLD`
 *     constants).
 *   - `estimateTokenCountFromChars` — pure char→token approximation
 *     (`Math.max(1, Math.ceil(charCount / 4))`); api-side helper.
 *   - `compactContextIfNeeded` — caller-side closure that mutates
 *     `currentMessages` + emits `context_compaction_started/done/failed`
 *     status events; returns the post-compaction snapshot. The gate
 *     invokes it only on the hard-zone branch.
 *   - `softZoneCode` / `hardZoneCode` — api-side string constants
 *     (`'context_budget_risk'` / `'context_budget_blocked'`) passed in
 *     so chat-core stays free of api-defined error code strings.
 *   - `maxReplanAttempts` — api-side constant `CONTEXT_BUDGET_MAX_REPLAN_ATTEMPTS = 1`.
 */
export interface ApplyContextBudgetGateInput {
  readonly streamId: string;
  readonly toolCall: {
    readonly id: string;
    readonly name: string;
  };
  readonly args: unknown;
  readonly preToolBudget: ContextBudgetSnapshot;
  readonly projectedResultChars: number;
  readonly streamSeq: number;
  readonly contextBudgetReplanAttempts: number;
  readonly maxReplanAttempts: number;
  readonly softZoneCode: string;
  readonly hardZoneCode: string;
  readonly resolveBudgetZone: (occupancyPct: number) => ContextBudgetZone;
  readonly estimateTokenCountFromChars: (charCount: number) => number;
  readonly compactContextIfNeeded: (
    reason: 'pre_tool_hard_threshold',
    snapshot: ContextBudgetSnapshot,
  ) => Promise<ContextBudgetSnapshot>;
}

/**
 * BR14b Lot 21e-1 — return shape of `ChatRuntime.applyContextBudgetGate`.
 *
 *   - `shouldContinue` — `true` when the gate emitted a deferred result
 *     and the caller must `continue` the for-loop (skip the per-tool
 *     dispatch via `executeServerTool`); `false` when the gate passed
 *     and the caller proceeds with the per-tool work. Mirrors the
 *     `continue` short-circuit at chat-service.ts line 3634 (pre-Lot 21e-1).
 *   - `streamSeq` — advanced cursor returned to the caller so it stays
 *     in sync with `deps.streamSequencer.allocate` (the gate emits up
 *     to two events on the deferred branch: a `tool_call_result` event
 *     and an optional `status:context_budget_user_escalation_required`
 *     event when `replanAttempts` exceeds `maxReplanAttempts`).
 *   - `contextBudgetReplanAttempts` — advanced counter (incremented on
 *     non-normal projected zone, reset to 0 on normal zone). Same
 *     semantics as the inline `contextBudgetReplanAttempts += 1` /
 *     `= 0` lines at chat-service.ts 3573 / 3636.
 *   - `preToolBudget` — possibly-updated snapshot returned to the caller
 *     so the projected payload accounting downstream uses the
 *     post-compaction state (mirrors the inline reassignment at line
 *     3568-3570 when the hard-zone branch fires).
 *   - `deferredAccumulator` — present only when `shouldContinue === true`:
 *     the three rows the caller must push into `toolResults` /
 *     `responseToolOutputs` / `executedTools`. The caller owns the
 *     accumulator arrays (they live in `runAssistantGeneration` outer
 *     scope alongside the rest of the per-iteration state) and the
 *     runtime stays accumulator-agnostic.
 */
export interface ApplyContextBudgetGateResult {
  readonly shouldContinue: boolean;
  readonly streamSeq: number;
  readonly contextBudgetReplanAttempts: number;
  readonly preToolBudget: ContextBudgetSnapshot;
  readonly deferredAccumulator?: {
    readonly deferredResult: {
      readonly status: 'deferred';
      readonly code: string;
      readonly message: string;
      readonly occupancy_pct: number;
      readonly estimated_tokens: number;
      readonly max_tokens: number;
      readonly replan_required: true;
      readonly escalation_required: boolean;
      readonly suggested_actions: ReadonlyArray<string>;
    };
    readonly toolCallId: string;
    readonly toolName: string;
    readonly args: unknown;
  };
}

/**
 * BR14b Lot 21e-3 — input to `ChatRuntime.finalizeAssistantIteration`.
 *
 * Bundles the post-`consumeToolCalls` blocks previously embedded in
 * `ChatService.runAssistantGeneration` (chat-service.ts lines 3618-3781
 * post-Lot 21e-2):
 *
 *   - Block A — per-iteration executed-tools trace emission
 *     (`writeChatGenerationTrace`) + todo runtime refresh (refetch +
 *     status reclassification through `TODO_TERMINAL_STATUSES` /
 *     `TODO_BLOCKING_STATUSES`).
 *   - Block B — `pendingLocalToolCalls` short-circuit: when local tools
 *     were dispatched, emit a `status:awaiting_local_tool_results` event
 *     + signal the caller to exit `runAssistantGeneration` (the inline
 *     body did `return;`).
 *   - Block C — assistant text history append + `needsExplicitToolReplay`
 *     rawInput rebuild (Codex / Anthropic / Mistral / Cohere providers
 *     need both `function_call` + `function_call_output` in `rawInput`).
 *
 * Two api-side closures cross as Option A callbacks (same pattern as
 * Lots 16a/16b/18/21c/21e-1): `writeChatGenerationTrace` (the
 * instrumentation hook) and `refreshSessionTodoRuntime` (bundles
 * `todoOrchestrationService.getSessionTodoRuntime` +
 * `toSessionTodoRuntimeSnapshot` + the api-side `TODO_TERMINAL_STATUSES`
 * / `TODO_BLOCKING_STATUSES` membership checks). Both are optional so
 * test fixtures can opt in without wiring the full api-land bundle.
 */
export interface FinalizeAssistantIterationInput {
  readonly streamId: string;
  // Block A — trace
  readonly traceEnabled: boolean;
  readonly sessionId: string;
  readonly assistantMessageId: string;
  readonly userId: string;
  readonly workspaceId: string | null;
  readonly iteration: number;
  readonly modelId: string | null;
  readonly toolChoice: 'auto' | 'required';
  readonly tools: ReadonlyArray<unknown> | null;
  readonly currentMessages: ReadonlyArray<unknown>;
  readonly previousResponseId: string | null;
  readonly responseToolOutputs: ReadonlyArray<{
    readonly type: 'function_call_output';
    readonly call_id: string;
    readonly output: string;
  }>;
  readonly toolCalls: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly args: string;
  }>;
  readonly executedTools: ReadonlyArray<AssistantRunLoopExecutedTool>;
  readonly writeChatGenerationTrace?: (input: {
    readonly enabled: boolean;
    readonly sessionId: string;
    readonly assistantMessageId: string;
    readonly userId: string;
    readonly workspaceId: string | null;
    readonly phase: 'pass1';
    readonly iteration: number;
    readonly model: string | null;
    readonly toolChoice: 'auto' | 'required';
    readonly tools: ReadonlyArray<unknown> | null;
    readonly openaiMessages: {
      readonly kind: 'executed_tools';
      readonly messages: ReadonlyArray<unknown>;
      readonly previous_response_id: string | null;
      readonly responses_input_tool_outputs: ReadonlyArray<unknown>;
    };
    readonly toolCalls: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly args: unknown;
      readonly result: unknown;
    }>;
    readonly meta: {
      readonly kind: string;
      readonly callSite: string;
      readonly openaiApi: string;
    };
  }) => Promise<void>;
  // Block A — todo refresh
  readonly todoAutonomousExtensionEnabled: boolean;
  readonly todoAwaitingUserInput: boolean;
  readonly refreshSessionTodoRuntime?: (input: {
    readonly sessionId: string;
    readonly userId: string;
    readonly workspaceId: string | null;
    readonly currentUserRole: string | null;
  }) => Promise<{
    readonly hasRefreshedSessionTodo: boolean;
    readonly todoContinuationActive: boolean;
    readonly todoAwaitingUserInputAfterRefresh: boolean;
  }>;
  readonly currentUserRole: string | null;
  // Block B — pendingLocalToolCalls
  readonly pendingLocalToolCalls: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly args: unknown;
  }>;
  readonly localTools: ReadonlyArray<{
    readonly type: 'function';
    readonly function: {
      readonly name: string;
      readonly description?: string;
      readonly parameters?: Record<string, unknown> | unknown;
    };
  }>;
  readonly vscodeCodeAgentPayload: NormalizedVsCodeCodeAgentRuntimePayload | null;
  readonly streamSeq: number;
  // Block C — needsExplicitToolReplay
  readonly useCodexTransport: boolean;
  readonly providerId: string;
  readonly contentParts: ReadonlyArray<string>;
}

/**
 * BR14b Lot 21e-3 — return shape of `ChatRuntime.finalizeAssistantIteration`.
 *
 *   - `shouldExitGeneration` — `true` when the `pendingLocalToolCalls`
 *     short-circuit fired; the caller `return`s out of
 *     `runAssistantGeneration` (mirrors the inline `return;` at
 *     chat-service.ts line 3743 pre-Lot 21e-3).
 *   - `streamSeq` — advanced cursor (Block B emits one status event when
 *     local tools pending; Block A is silent unless the trace callback
 *     emits events of its own).
 *   - `currentMessages` — possibly appended with the assistant text
 *     turn (Block C: `[...currentMessages, { role: 'assistant', content }]`).
 *   - `previousResponseId` — possibly cleared to `null` (Block C: when
 *     `useCodexTransport === true`).
 *   - `pendingResponsesRawInput` — rebuilt rawInput for the next
 *     iteration (Block C: function_call + function_call_output replay
 *     pairs for non-Responses-API providers, or the raw responseToolOutputs).
 *   - `todoContinuationActive` / `todoAwaitingUserInput` — updated
 *     booleans from Block A's todo refresh (the caller's outer `let`
 *     slots are reassigned from these). When the refresh callback is not
 *     wired or skipped, these mirror the input values verbatim.
 */
export interface FinalizeAssistantIterationResult {
  readonly shouldExitGeneration: boolean;
  readonly streamSeq: number;
  readonly currentMessages: ReadonlyArray<unknown>;
  readonly previousResponseId: string | null;
  readonly pendingResponsesRawInput: ReadonlyArray<unknown>;
  readonly todoContinuationActive: boolean;
  readonly todoAwaitingUserInput: boolean;
}

/**
 * BR14b Lot 21e-3 — input to `ChatRuntime.emitFinalAssistantTurn`.
 *
 * Bundles the post-while-loop terminal slice previously embedded in
 * `ChatService.runAssistantGeneration` (chat-service.ts lines 3892-3902
 * pre-Lot 21e-3):
 *
 *   - Emit a single `done` event on the stream (the only terminal event
 *     of the run).
 *   - Persist the final assistant content + reasoning via
 *     `MessageStore.updateAssistantContent`.
 *   - Touch the session's `updatedAt` timestamp via
 *     `SessionStore.touchUpdatedAt`.
 *
 * Crosses no port boundary because both stores live on `deps`. Returns
 * the advanced `streamSeq` so the caller can keep its cursor in sync
 * (the value is currently unused post-finalize but mirrors the inline
 * `streamSeq += 1` line for symmetry with other helpers).
 */
export interface EmitFinalAssistantTurnInput {
  readonly streamId: string;
  readonly assistantMessageId: string;
  readonly sessionId: string;
  readonly streamSeq: number;
  readonly content: string;
  readonly reasoning: string | null;
  readonly model: string | null;
}

export interface EmitFinalAssistantTurnResult {
  readonly streamSeq: number;
}

/**
 * BR14b Lot 22a-2 — input to `ChatRuntime.runPass2Fallback`.
 *
 * Bundles the pass2 fallback block previously embedded in
 * `ChatService.runAssistantGeneration` (chat-service.ts lines 3707-3813
 * post-Lot 22a-1, ~107l). The block runs AFTER the main tool loop +
 * `finalizeAssistantIteration` finishes and BEFORE `emitFinalAssistantTurn`
 * — it kicks in when the assistant produced no usable content
 * (`!contentParts.join('').trim()`) and forces a clean second pass
 * with tools disabled (`toolChoice='none'`, `tools=undefined`) and a
 * tool-digest summary baked into the user message.
 *
 * Inputs cover:
 *   - identity + transport: `streamId`, `assistantMessageId`, `sessionId`,
 *     `userId`, `workspaceId`, `providerId`, `model`, `credential`,
 *     `signal`, `reasoningEffort`.
 *   - context to rebuild pass2 messages: `conversation`,
 *     `executedTools` (digest source), `systemPrompt` (extended with the
 *     pass2 directives).
 *   - mutable buffers reset+filled in-place verbatim: `contentParts`,
 *     `reasoningParts`. The caller's outer `let` accumulators are passed
 *     by reference exactly like the inline body (`contentParts.length = 0`,
 *     `contentParts.push(delta)`).
 *   - cursor: `streamSeq` (advanced and returned).
 *   - tracing: `traceEnabled` + optional `writeChatGenerationTrace` Option A
 *     callback (same pattern as Lot 21e-3 / 22a-1). When the callback is
 *     undefined (test harness) the pass2_prompt trace is silently skipped.
 */
export interface RunPass2FallbackInput {
  readonly streamId: string;
  readonly assistantMessageId: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly workspaceId: string | null;
  readonly providerId: string;
  readonly model: string;
  readonly credential?: string;
  readonly signal?: AbortSignal;
  readonly reasoningEffort?:
    | 'none'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh';
  readonly conversation: ReadonlyArray<{
    readonly role: 'system' | 'user' | 'assistant';
    readonly content: string;
  }>;
  readonly executedTools: ReadonlyArray<{
    readonly name: string;
    readonly result: unknown;
  }>;
  readonly systemPrompt: string;
  readonly contentParts: string[];
  readonly reasoningParts: string[];
  readonly streamSeq: number;
  readonly traceEnabled: boolean;
  readonly writeChatGenerationTrace?: (input: {
    readonly enabled: boolean;
    readonly sessionId: string;
    readonly assistantMessageId: string;
    readonly userId: string;
    readonly workspaceId: string | null;
    readonly phase: 'pass2';
    readonly iteration: number;
    readonly model: string | null;
    readonly toolChoice: 'none';
    readonly tools: null;
    readonly openaiMessages: ReadonlyArray<{
      readonly role: 'system' | 'user' | 'assistant';
      readonly content: string;
    }>;
    readonly toolCalls: null;
    readonly meta: {
      readonly kind: 'pass2_prompt';
      readonly callSite: string;
      readonly openaiApi: 'responses';
    };
  }) => Promise<void>;
}

/**
 * BR14b Lot 22a-2 — return shape of `ChatRuntime.runPass2Fallback`.
 *
 *   - `skipped` — `true` when the guard short-circuited (caller-side
 *     `contentParts.join('').trim()` already non-empty). When `true`,
 *     `streamSeq` mirrors the input cursor verbatim and the mutable
 *     buffers are untouched.
 *   - `streamSeq` — advanced cursor reflecting every event emitted by
 *     the pass2 mesh stream (mirrors the inline `streamSeq += 1` after
 *     each `writeStreamEvent` call).
 *   - `lastErrorMessage` — last captured pass2 error message (mirrors
 *     the inline `lastErrorMessage` `let` reassignment on `error`
 *     events). `null` when no error event was observed.
 */
export interface RunPass2FallbackResult {
  readonly skipped: boolean;
  readonly streamSeq: number;
  readonly lastErrorMessage: string | null;
}

/**
 * Verbatim duplicate of `asRecord` in `chat-service.ts` (line ~261).
 * Tiny pure helper, duplicated rather than re-imported to keep
 * chat-core free of any api/* module dependency.
 */
export const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

/**
 * Verbatim duplicate of `isValidToolName` in `chat-service.ts` (line ~272).
 *
 * Exported (BR14b Lot 22b-3) so the `ChatRuntimeMessages` sub-class can
 * reuse it from `extractAwaitingLocalToolState` without re-declaring the
 * regex. `asRecord` is exported alongside for the same reason — both
 * helpers are pure shape utilities, no module-level side effect.
 */
export const isValidToolName = (value: string): boolean =>
  /^[a-zA-Z0-9_-]{1,64}$/.test(value);

/**
 * Composite-key encoder for `CheckpointStore<ChatState>`. Mirrors the
 * encoder owned by the postgres adapter byte-for-byte so the runtime
 * and the adapter agree on the key shape. Duplicated rather than
 * imported because chat-core must not depend on `api/*`.
 *
 * Format: `${sessionId}#${checkpointId}`. The `#` separator is
 * forbidden in our id alphabet (UUID v4 characters), guaranteeing
 * unambiguous parsing.
 */
const CHAT_CHECKPOINT_KEY_SEPARATOR = '#';

export const encodeChatCheckpointKey = (
  sessionId: string,
  checkpointId: string,
): string => `${sessionId}${CHAT_CHECKPOINT_KEY_SEPARATOR}${checkpointId}`;

const parseChatCheckpointKey = (
  key: string,
): { sessionId: string; checkpointId: string } | null => {
  const idx = key.indexOf(CHAT_CHECKPOINT_KEY_SEPARATOR);
  if (idx <= 0 || idx === key.length - 1) return null;
  return {
    sessionId: key.slice(0, idx),
    checkpointId: key.slice(idx + 1),
  };
};

/**
 * Project a `ChatStateSnapshot` (loaded via `CheckpointStore.load`)
 * back into the `ChatCheckpointSummary` shape that the chat API
 * surface returns. Mirrors the mapping previously embedded in
 * `postgresChatCheckpointAdapter.listCheckpointsForSession`.
 */
export const summaryFromSnapshot = (
  snapshot: ChatStateSnapshot,
  createdAtIso: string,
): ChatCheckpointSummary => {
  const titleRaw = String(snapshot.title ?? '').trim();
  const anchorMessageId = String(snapshot.anchorMessageId ?? '').trim();
  const anchorSequence = Number(snapshot.anchorSequence ?? 0);
  const messageCount = Number(snapshot.messageCount ?? 0);
  return {
    id: snapshot.id,
    title: titleRaw || `Checkpoint #${anchorSequence || 0}`,
    anchorMessageId,
    anchorSequence: Number.isFinite(anchorSequence) ? anchorSequence : 0,
    messageCount: Number.isFinite(messageCount) ? messageCount : 0,
    createdAt: createdAtIso,
  };
};

/**
 * Project a `ChatMessageRow` (from `MessageStore.listForSession`)
 * into the `ChatStateSnapshotMessage` shape persisted in the
 * checkpoint payload. Mirrors the inline mapping previously embedded
 * in `postgresChatCheckpointAdapter.createCheckpointForSession`
 * (snapshotMessages map). Selects the same column set verbatim.
 */
export const snapshotMessageFromRow = (
  message: ChatMessageRow,
): ChatStateSnapshotMessage => ({
  id: message.id,
  role: message.role,
  content: message.content,
  contexts: message.contexts,
  toolCalls: message.toolCalls,
  toolCallId: message.toolCallId,
  reasoning: message.reasoning,
  model: message.model,
  promptId: message.promptId,
  promptVersionId: message.promptVersionId,
  sequence: message.sequence,
  createdAt:
    message.createdAt instanceof Date
      ? message.createdAt.toISOString()
      : String(message.createdAt ?? ''),
});

/**
 * Verbatim duplicate of `ChatService.serializeToolOutput` (line ~865).
 * Used to normalize follow-up tool_call_result event payloads collected
 * during `acceptLocalToolResult`. Kept as a module helper because the
 * corresponding `chat-service.ts` instance method is also used by
 * `runAssistantGeneration` which does not migrate in Lot 10 — future
 * lots will consolidate.
 *
 * Exported (BR14b Lot 22b-3) so the `ChatRuntimeMessages` sub-class can
 * import it for its migrated `acceptLocalToolResult` body without
 * duplicating the implementation.
 */
export const serializeToolOutput = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ value: String(value) });
  }
};

export class ChatRuntime {
  /**
   * BR14b Lot 22b — god-class split façade. Sub-classes share the same
   * `deps` reference (no copy, no state duplication).
   *
   * - Lot 22b-1: `checkpoint` — `createCheckpoint` / `listCheckpoints`
   *   / `restoreCheckpoint` (3 delegators).
   * - Lot 22b-2: `session` — `listMessages` / `getSessionBootstrap` /
   *   `getSessionHistory` / `getMessageRuntimeDetails` (4 delegators).
   *   `ChatRuntimeSession` receives the sibling `checkpoint` instance
   *   so its `getSessionBootstrap` / `getSessionHistory` can re-issue
   *   `listCheckpoints` against the same `ChatRuntimeCheckpoint`
   *   without a façade round-trip.
   * - Lot 22b-3: `messages` — `finalizeAssistantMessageFromStream` /
   *   `acceptLocalToolResult` / `setMessageFeedback` /
   *   `updateUserMessageContent` / `retryUserMessage` /
   *   `createUserMessageWithAssistantPlaceholder` (6 delegators) +
   *   the private `extractAwaitingLocalToolState` helper that travels
   *   with `acceptLocalToolResult` (its sole caller). Step 0 cross-class
   *   dep re-scan confirmed zero cross-sub-class `this.<method>` calls,
   *   so `ChatRuntimeMessages` takes only `deps` at construction (no
   *   sibling-injection, matching `ChatRuntimeCheckpoint`).
   * - Lot 22b-4: `runPrepare` — `prepareAssistantRun` / `ensureSessionTitle`
   *   / `prepareSystemPrompt` / `resolveModelSelection` /
   *   `evaluateReasoningEffort` / `allocateStreamSequence` /
   *   `peekStreamSequence` / `initToolLoopState` / `beginAssistantRunLoop`
   *   (9 delegators). Step 0 cross-class dep re-scan confirmed zero
   *   cross-sub-class `this.<method>` calls: the three internal calls
   *   (`initToolLoopState` → `resolveModelSelection` +
   *   `evaluateReasoningEffort` + `peekStreamSequence`) all live inside
   *   the SAME sub-class, so `ChatRuntimeRunPrepare` takes only `deps`
   *   at construction (no sibling-injection, matching
   *   `ChatRuntimeCheckpoint` / `ChatRuntimeMessages`).
   * - Lot 22b-5: `toolDispatch` — `consumeAssistantStream` /
   *   `executeServerTool` / `consumeToolCalls` / `applyContextBudgetGate`
   *   (4 delegators). Step 0 cross-class dep re-scan confirmed zero
   *   cross-sub-class `this.<method>` calls: the two internal calls
   *   (`consumeToolCalls` → `applyContextBudgetGate` +
   *   `executeServerTool`) all live inside the SAME sub-class, so
   *   `ChatRuntimeToolDispatch` takes only `deps` at construction (no
   *   sibling-injection, matching `ChatRuntimeCheckpoint` /
   *   `ChatRuntimeMessages` / `ChatRuntimeRunPrepare`).
   * - Lot 22b-6: `finalization` — `finalizeAssistantIteration` /
   *   `emitFinalAssistantTurn` / `runPass2Fallback` (3 delegators). Step 0
   *   cross-class dep re-scan confirmed zero cross-sub-class
   *   `this.<method>` calls: the 3 methods only touch `this.deps.*` and
   *   module-scope helpers (`safeTruncateForRuntime`,
   *   `safeJsonForRuntime`, `buildToolDigestForRuntime`) which moved
   *   with `runPass2Fallback` into `runtime-finalization.ts`. So
   *   `ChatRuntimeFinalization` takes only `deps` at construction (no
   *   sibling-injection, matching `ChatRuntimeCheckpoint` /
   *   `ChatRuntimeMessages` / `ChatRuntimeRunPrepare` /
   *   `ChatRuntimeToolDispatch`).
   */
  private readonly checkpoint: ChatRuntimeCheckpoint;
  private readonly session: ChatRuntimeSession;
  private readonly messages: ChatRuntimeMessages;
  private readonly runPrepare: ChatRuntimeRunPrepare;
  private readonly toolDispatch: ChatRuntimeToolDispatch;
  private readonly finalization: ChatRuntimeFinalization;

  constructor(private readonly deps: ChatRuntimeDeps) {
    this.checkpoint = new ChatRuntimeCheckpoint(deps);
    this.session = new ChatRuntimeSession(deps, this.checkpoint);
    this.messages = new ChatRuntimeMessages(deps);
    this.runPrepare = new ChatRuntimeRunPrepare(deps);
    this.toolDispatch = new ChatRuntimeToolDispatch(deps);
    this.finalization = new ChatRuntimeFinalization(deps);
  }

  /**
   * BR14b Lot 22b-3 — Façade delegator. Body lives in
   * `ChatRuntimeMessages.finalizeAssistantMessageFromStream` (originally
   * migrated in Lot 9 from `ChatService.finalizeAssistantMessageFromStream`).
   */
  async finalizeAssistantMessageFromStream(
    options: FinalizeAssistantOptions,
  ): Promise<FinalizeAssistantResult | null> {
    return this.messages.finalizeAssistantMessageFromStream(options);
  }

  /**
   * BR14b Lot 22b-3 — Façade delegator. Body lives in
   * `ChatRuntimeMessages.acceptLocalToolResult` (originally migrated in
   * Lot 10 from `ChatService.acceptLocalToolResult`). The private
   * `extractAwaitingLocalToolState` helper moves with it — it is only
   * ever invoked from `acceptLocalToolResult`, so the façade does NOT
   * expose it.
   */
  async acceptLocalToolResult(
    options: AcceptLocalToolResultOptions,
  ): Promise<AcceptLocalToolResultResponse> {
    return this.messages.acceptLocalToolResult(options);
  }

  /**
   * Create a checkpoint of the current session state. Delegates to
   * `ChatRuntimeCheckpoint.createCheckpoint`. See sub-class for the
   * full per-method JSDoc and the verbatim port history (BR14b Lot 4
   * adapter migration, Lot 11 runtime move, Lot 22b-1 façade split).
   */
  async createCheckpoint(
    options: CreateCheckpointOptions,
  ): Promise<ChatCheckpointSummary> {
    return this.checkpoint.createCheckpoint(options);
  }

  /**
   * List checkpoints for a session, newest first. Delegates to
   * `ChatRuntimeCheckpoint.listCheckpoints`. See sub-class for the
   * full per-method JSDoc and the verbatim port history (BR14b Lot 4
   * adapter migration, Lot 11 runtime move, Lot 22b-1 façade split).
   */
  async listCheckpoints(
    options: ListCheckpointsOptions,
  ): Promise<ChatCheckpointSummary[]> {
    return this.checkpoint.listCheckpoints(options);
  }

  /**
   * Restore a checkpoint. Delegates to
   * `ChatRuntimeCheckpoint.restoreCheckpoint`. See sub-class for the
   * full per-method JSDoc and the verbatim port history (BR14b Lot 4
   * adapter migration, Lot 11 runtime move, Lot 22b-1 façade split).
   */
  async restoreCheckpoint(
    options: RestoreCheckpointOptions,
  ): Promise<RestoreCheckpointResult> {
    return this.checkpoint.restoreCheckpoint(options);
  }

  /**
   * BR14b Lot 22b-4 — Façade delegator. Body lives in
   * `ChatRuntimeRunPrepare.resolveModelSelection` (originally migrated
   * in Lot 17 as a public wrapper around the `deps.resolveModelSelection`
   * callback added in Lot 12).
   */
  async resolveModelSelection(
    input: Parameters<ChatRuntimeDeps['resolveModelSelection']>[0],
  ): ReturnType<ChatRuntimeDeps['resolveModelSelection']> {
    return this.runPrepare.resolveModelSelection(input);
  }

  /**
   * BR14b Lot 22b-3 — Façade delegator. Body lives in
   * `ChatRuntimeMessages.retryUserMessage` (originally migrated in
   * Lot 12 from `ChatService.retryUserMessage`).
   */
  async retryUserMessage(
    options: RetryUserMessageOptions,
  ): Promise<RetryUserMessageResult> {
    return this.messages.retryUserMessage(options);
  }

  /**
   * BR14b Lot 22b-3 — Façade delegator. Body lives in
   * `ChatRuntimeMessages.createUserMessageWithAssistantPlaceholder`
   * (originally migrated in Lot 12 from
   * `ChatService.createUserMessageWithAssistantPlaceholder`).
   */
  async createUserMessageWithAssistantPlaceholder(
    input: RuntimeCreateChatMessageInput,
  ): Promise<CreateUserMessageResult> {
    return this.messages.createUserMessageWithAssistantPlaceholder(input);
  }

  /**
   * BR14b Lot 22b-3 — Façade delegator. Body lives in
   * `ChatRuntimeMessages.setMessageFeedback` (originally migrated in
   * Lot 13 from `ChatService.setMessageFeedback`).
   */
  async setMessageFeedback(options: {
    messageId: string;
    userId: string;
    vote: 'up' | 'down' | 'clear';
  }) {
    return this.messages.setMessageFeedback(options);
  }

  /**
   * BR14b Lot 22b-3 — Façade delegator. Body lives in
   * `ChatRuntimeMessages.updateUserMessageContent` (originally migrated in
   * Lot 13 from `ChatService.updateUserMessageContent`).
   */
  async updateUserMessageContent(options: {
    messageId: string;
    userId: string;
    content: string;
  }) {
    return this.messages.updateUserMessageContent(options);
  }

  /**
   * BR14b Lot 22b-2 — Façade delegator. Body lives in
   * `ChatRuntimeSession.listMessages` (originally migrated in Lot 14a
   * from `ChatService.listMessages`).
   */
  async listMessages(
    sessionId: string,
    userId: string,
  ): Promise<{
    messages: ChatMessageWithFeedback[];
    todoRuntime: Record<string, unknown> | null;
  }> {
    return this.session.listMessages(sessionId, userId);
  }

  /**
   * BR14b Lot 22b-2 — Façade delegator. Body lives in
   * `ChatRuntimeSession.getSessionBootstrap` (originally migrated in
   * Lot 14b from `ChatService.getSessionBootstrap`).
   */
  async getSessionBootstrap(
    options: GetSessionBootstrapOptions,
  ): Promise<GetSessionBootstrapResult> {
    return this.session.getSessionBootstrap(options);
  }

  /**
   * BR14b Lot 22b-2 — Façade delegator. Body lives in
   * `ChatRuntimeSession.getSessionHistory` (originally migrated in
   * Lot 14b from `ChatService.getSessionHistory`).
   */
  async getSessionHistory(
    options: GetSessionHistoryOptions,
  ): Promise<GetSessionHistoryResult> {
    return this.session.getSessionHistory(options);
  }

  /**
   * BR14b Lot 22b-2 — Façade delegator. Body lives in
   * `ChatRuntimeSession.getMessageRuntimeDetails` (originally migrated
   * in Lot 14b from `ChatService.getMessageRuntimeDetails`).
   */
  async getMessageRuntimeDetails(
    options: GetMessageRuntimeDetailsOptions,
  ): Promise<GetMessageRuntimeDetailsResult> {
    return this.session.getMessageRuntimeDetails(options);
  }

  /**
   * BR14b Lot 22b-4 — Façade delegator. Body lives in
   * `ChatRuntimeRunPrepare.prepareAssistantRun` (originally migrated in
   * Lot 15 from `ChatService.runAssistantGeneration` precheck slice).
   */
  async prepareAssistantRun(
    options: PrepareAssistantRunOptions,
  ): Promise<AssistantRunContext> {
    return this.runPrepare.prepareAssistantRun(options);
  }

  /**
   * BR14b Lot 22b-4 — Façade delegator. Body lives in
   * `ChatRuntimeRunPrepare.ensureSessionTitle` (originally migrated in
   * Lot 16a from `ChatService.runAssistantGeneration` title-generation
   * side effect).
   */
  async ensureSessionTitle(
    options: EnsureSessionTitleOptions,
  ): Promise<string | null> {
    return this.runPrepare.ensureSessionTitle(options);
  }

  /**
   * BR14b Lot 22b-4 — Façade delegator. Body lives in
   * `ChatRuntimeRunPrepare.prepareSystemPrompt` (originally migrated in
   * Lot 16b as a wrapper around the `deps.buildSystemPrompt` callback).
   */
  async prepareSystemPrompt(
    ctx: AssistantRunContext,
    options: PrepareSystemPromptOptions & {
      readonly userId: string;
      readonly sessionId: string;
    },
  ): Promise<BuildSystemPromptResult> {
    return this.runPrepare.prepareSystemPrompt(ctx, options);
  }

  /**
   * BR14b Lot 22b-4 — Façade delegator. Body lives in
   * `ChatRuntimeRunPrepare.evaluateReasoningEffort` (originally migrated
   * in Lot 18 + extended in Lot 20 with the two bracketing status
   * events `reasoning_effort_eval_failed` / `reasoning_effort_selected`).
   */
  async evaluateReasoningEffort(
    input: EvaluateReasoningEffortInput,
  ): Promise<ReasoningEffortEvaluation> {
    return this.runPrepare.evaluateReasoningEffort(input);
  }

  /**
   * BR14b Lot 22b-4 — Façade delegator. Body lives in
   * `ChatRuntimeRunPrepare.allocateStreamSequence` (originally migrated
   * in Lot 20 as a slim wrapper over `deps.streamSequencer.allocate`).
   */
  async allocateStreamSequence(streamId: string): Promise<number> {
    return this.runPrepare.allocateStreamSequence(streamId);
  }

  /**
   * BR14b Lot 22b-4 — Façade delegator. Body lives in
   * `ChatRuntimeRunPrepare.peekStreamSequence` (originally migrated in
   * Lot 20 as a slim wrapper over `deps.streamSequencer.peek`).
   */
  async peekStreamSequence(streamId: string): Promise<number> {
    return this.runPrepare.peekStreamSequence(streamId);
  }

  /**
   * BR14b Lot 22b-4 — Façade delegator. Body lives in
   * `ChatRuntimeRunPrepare.initToolLoopState` (originally migrated in
   * Lot 22a-1 from `ChatService.runAssistantGeneration` pre-loop init
   * slice — resolve model + derive codex transport + mutate loopState
   * + evaluate reasoning + re-sync streamSeq).
   */
  async initToolLoopState(
    input: InitToolLoopStateInput,
  ): Promise<InitToolLoopStateResult> {
    return this.runPrepare.initToolLoopState(input);
  }

  /**
   * BR14b Lot 22b-5 — Façade delegator. Body lives in
   * `ChatRuntimeToolDispatch.consumeAssistantStream` (originally migrated
   * in Lot 21b from `ChatService.runAssistantGeneration` mesh-stream
   * consumption block — `chat-service.ts` lines 3203-3384 pre-Lot 21b).
   */
  async consumeAssistantStream(
    input: ConsumeAssistantStreamInput,
  ): Promise<ConsumeAssistantStreamResult> {
    return this.toolDispatch.consumeAssistantStream(input);
  }

  /**
   * BR14b Lot 22b-4 — Façade delegator. Body lives in
   * `ChatRuntimeRunPrepare.beginAssistantRunLoop` (originally migrated
   * in Lot 21a from `ChatService.runAssistantGeneration` loop-setup
   * block — 40-line struct init mirroring the inline declaration).
   */
  async beginAssistantRunLoop(
    input: BeginAssistantRunLoopInput,
  ): Promise<AssistantRunLoopState> {
    return this.runPrepare.beginAssistantRunLoop(input);
  }

  /**
   * BR14b Lot 22b-5 — Façade delegator. Body lives in
   * `ChatRuntimeToolDispatch.executeServerTool` (originally migrated in
   * Lot 21d-3 from `ChatService.runAssistantGeneration` per-tool
   * dispatch closure into the runtime facade over the
   * `deps.executeServerTool` Option A callback).
   */
  async executeServerTool(
    input: ExecuteServerToolInput,
  ): Promise<ExecuteServerToolResult> {
    return this.toolDispatch.executeServerTool(input);
  }

  /**
   * BR14b Lot 22b-5 — Façade delegator. Body lives in
   * `ChatRuntimeToolDispatch.consumeToolCalls` (originally migrated in
   * Lot 21c / 21e-2 from `ChatService.runAssistantGeneration` per-tool
   * for-loop block — `chat-service.ts` lines 3514-3741 pre-Lot 21e-2).
   */
  async consumeToolCalls(
    input: ConsumeToolCallsInput,
  ): Promise<ConsumeToolCallsResult> {
    return this.toolDispatch.consumeToolCalls(input);
  }

  /**
   * BR14b Lot 22b-5 — Façade delegator. Body lives in
   * `ChatRuntimeToolDispatch.applyContextBudgetGate` (originally
   * migrated in Lot 21e-1 from `ChatService.runAssistantGeneration`
   * per-tool budget-gate block — `chat-service.ts` lines 3534-3636
   * post-Lot 21d-3).
   */
  async applyContextBudgetGate(
    input: ApplyContextBudgetGateInput,
  ): Promise<ApplyContextBudgetGateResult> {
    return this.toolDispatch.applyContextBudgetGate(input);
  }

  /**
   * BR14b Lot 22b-6 — Façade delegator. Body lives in
   * `ChatRuntimeFinalization.finalizeAssistantIteration` (originally
   * migrated in Lot 21e-3 from `ChatService.runAssistantGeneration`
   * per-iteration finalization block — `chat-service.ts` lines
   * 3618-3781 post-Lot 21e-2).
   */
  async finalizeAssistantIteration(
    input: FinalizeAssistantIterationInput,
  ): Promise<FinalizeAssistantIterationResult> {
    return this.finalization.finalizeAssistantIteration(input);
  }

  /**
   * BR14b Lot 22b-6 — Façade delegator. Body lives in
   * `ChatRuntimeFinalization.emitFinalAssistantTurn` (originally
   * migrated in Lot 21e-3 from `ChatService.runAssistantGeneration`
   * terminal finalization slice — `chat-service.ts` lines 3892-3902
   * post-Lot 21e-2).
   */
  async emitFinalAssistantTurn(
    input: EmitFinalAssistantTurnInput,
  ): Promise<EmitFinalAssistantTurnResult> {
    return this.finalization.emitFinalAssistantTurn(input);
  }

  /**
   * BR14b Lot 22b-6 — Façade delegator. Body lives in
   * `ChatRuntimeFinalization.runPass2Fallback` (originally migrated in
   * Lot 22a-2 from `ChatService.runAssistantGeneration` pass2 fallback
   * slice — `chat-service.ts` lines 3707-3813 post-Lot 22a-1).
   */
  async runPass2Fallback(
    input: RunPass2FallbackInput,
  ): Promise<RunPass2FallbackResult> {
    return this.finalization.runPass2Fallback(input);
  }
}

/**
 * BR14b Lot 21c — verbatim duplicate of `parseToolCallArgs` from
 * `chat-service.ts` line 265. Module-scope so the local-tool
 * short-circuit can parse `tool_call.args` without taking the helper
 * as a dep (same convention as `STEER_REASONING_REPLAY_MAX_CHARS` /
 * `asRecord` from Lot 21b).
 *
 * Exported (BR14b Lot 22b-5) so the `ChatRuntimeToolDispatch` sub-class
 * can import it for its migrated `consumeToolCalls` body without
 * duplicating the implementation.
 */
export const parseToolCallArgsForRuntime = (value: unknown): unknown => {
  if (typeof value !== 'string') return value ?? {};
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return {};
  }
};

// Suppress the lint warning for the unused parseChatCheckpointKey
// helper: it is exported as a runtime utility for future debugging /
// migration tooling. Keeping it next to `encodeChatCheckpointKey`
// ensures the key shape stays symmetric in one file.
void parseChatCheckpointKey;
