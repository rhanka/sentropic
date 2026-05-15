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
import { randomUUID } from 'node:crypto';

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
import { isPreviousResponseNotFoundError } from './mesh-errors.js';
import { consumePendingSteerMessages } from './steer.js';
import {
  buildAssistantMessageHistoryDetails,
  buildChatHistoryTimeline,
  compactChatHistoryTimelineForSummary,
  type ChatHistoryMessage,
  type ChatHistoryStreamEvent,
  type ChatHistoryTimelineItem,
} from './history.js';

/**
 * BR14b Lot 21b — max characters captured into
 * `AssistantRunLoopState.steerReasoningReplay`. Lifted verbatim from
 * `chat-service.ts` line 2822 pre-Lot 21b (`const STEER_REASONING_REPLAY_MAX_CHARS = 6000`).
 * Lives at module scope so `consumeAssistantStream` can clamp the
 * reasoning replay buffer without taking the constant as an input.
 */
const STEER_REASONING_REPLAY_MAX_CHARS = 6000;

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
 */
type AwaitingLocalToolState = {
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
 * BR14b Lot 21c — input to `ChatRuntime.consumeToolCalls`. Mirrors the
 * per-iteration tool-dispatch entry at chat-service.ts line 3267
 * post-Lot 21b. Same mutate-in-place convention as
 * `consumeAssistantStream`. `localToolNames` is the legacy
 * `localToolNames` Set; the remaining fields (`sessionId` / `userId` /
 * `workspaceId` / `providerId` / `modelId` / `tools` /
 * `enforceTodoUpdateMode` / `readOnly` / `signal`) are forwarded to
 * `executeServerTool` for non-local calls. Lot 21c lands only the
 * type surface + the orchestration skeleton; per-tool dispatch
 * migration deferred to Lot 21d.
 */
export interface ConsumeToolCallsInput {
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
}

/**
 * BR14b Lot 21c — return shape of `ChatRuntime.consumeToolCalls`.
 * Aggregated per-iteration outputs that mirror the inline body's
 * `toolResults` (role:'tool' messages), `responseToolOutputs`
 * (`function_call_output` rawInput entries), `pendingLocalToolCalls`
 * (post-loop `awaiting_local_tool_results` queue), `executedTools`
 * (trace accumulator), and `shouldBreakLoop` (mirrors the
 * `continueGenerationLoop = false; break;` branch on empty toolCalls).
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
}

/**
 * Verbatim duplicate of `asRecord` in `chat-service.ts` (line ~261).
 * Tiny pure helper, duplicated rather than re-imported to keep
 * chat-core free of any api/* module dependency.
 */
const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

/**
 * Verbatim duplicate of `isValidToolName` in `chat-service.ts` (line ~272).
 */
const isValidToolName = (value: string): boolean =>
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

const encodeChatCheckpointKey = (
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
const summaryFromSnapshot = (
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
const snapshotMessageFromRow = (
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
 * during `acceptLocalToolResult`. Kept as a private module helper
 * because the corresponding `chat-service.ts` instance method is also
 * used by `runAssistantGeneration` which does not migrate in Lot 10 —
 * future lots will consolidate.
 */
const serializeToolOutput = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ value: String(value) });
  }
};

export class ChatRuntime {
  constructor(private readonly deps: ChatRuntimeDeps) {}

  /**
   * Finalize an assistant message after its SSE stream has been
   * consumed: aggregate `content_delta` and `reasoning_delta` events,
   * persist the final assistant content/reasoning, and write a
   * terminating `done` event if none was written yet.
   *
   * Migrated verbatim from `ChatService.finalizeAssistantMessageFromStream`
   * (chat-service.ts pre-Lot 9). Only difference: replaces the three
   * stream-service free functions (`getNextSequence`, `readStreamEvents`,
   * `writeStreamEvent`) with the equivalent `StreamBuffer` port methods
   * (`getNextSequence`, `read`, `append`) — those functions were already
   * a thin shim over the same adapter in Lot 7.
   *
   * Returns `null` when the message doesn't exist or isn't an assistant
   * message (preserves the legacy null-on-skip contract used by callers
   * in `routes/api/chat.ts` and `queue-manager.ts`).
   */
  async finalizeAssistantMessageFromStream(
    options: FinalizeAssistantOptions,
  ): Promise<FinalizeAssistantResult | null> {
    const { assistantMessageId, reason, fallbackContent } = options;
    const msg = await this.deps.messageStore.findById(assistantMessageId);

    if (!msg || msg.role !== 'assistant') return null;

    const events = await this.deps.streamBuffer.read(assistantMessageId);
    const hasTerminal = events.some(
      (ev) => ev.eventType === 'done' || ev.eventType === 'error',
    );

    const contentParts: string[] = [];
    const reasoningParts: string[] = [];
    for (const ev of events) {
      if (ev.eventType === 'content_delta') {
        const data = ev.data as { delta?: unknown } | null;
        const delta = typeof data?.delta === 'string' ? data.delta : '';
        if (delta) contentParts.push(delta);
      } else if (ev.eventType === 'reasoning_delta') {
        const data = ev.data as { delta?: unknown } | null;
        const delta = typeof data?.delta === 'string' ? data.delta : '';
        if (delta) reasoningParts.push(delta);
      }
    }

    let content = contentParts.join('');
    if (!content.trim() && fallbackContent) content = fallbackContent;

    const shouldUpdateContent = !msg.content || msg.content.trim().length === 0;
    if (shouldUpdateContent && content) {
      await this.deps.messageStore.updateAssistantContent(assistantMessageId, {
        content,
        reasoning: reasoningParts.length > 0 ? reasoningParts.join('') : null,
      });
    }

    let wroteDone = false;
    if (!hasTerminal) {
      const seq = await this.deps.streamBuffer.getNextSequence(assistantMessageId);
      await this.deps.streamBuffer.append(
        assistantMessageId,
        'done' satisfies StreamEventTypeName,
        { reason: reason ?? 'cancelled' },
        seq,
        assistantMessageId,
      );
      wroteDone = true;
    }

    await this.deps.sessionStore.touchUpdatedAt(msg.sessionId);

    return {
      content,
      reasoning: reasoningParts.length > 0 ? reasoningParts.join('') : null,
      wroteDone,
    };
  }

  /**
   * Extract `AwaitingLocalToolState` from the latest
   * `awaiting_local_tool_results` status event in the assistant message
   * stream. Migrated verbatim from
   * `ChatService.extractAwaitingLocalToolState` (chat-service.ts pre Lot 10).
   * Only behavior difference: the VsCode normalizer is provided via
   * `this.deps.normalizeVsCodeCodeAgent` callback instead of the
   * `ChatService` instance method — the body is unchanged.
   */
  private extractAwaitingLocalToolState(
    events: Array<{
      eventType: string;
      data: unknown;
      sequence: number;
    }>,
  ): AwaitingLocalToolState | null {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.eventType !== 'status') continue;
      const data = asRecord(event.data);
      if (!data || data.state !== 'awaiting_local_tool_results') continue;

      const previousResponseId =
        typeof data.previous_response_id === 'string' ? data.previous_response_id : '';
      if (!previousResponseId) return null;

      const pendingLocalToolCalls: Array<{
        id: string;
        name: string;
        args: unknown;
      }> = [];
      const pendingRaw = Array.isArray(data.pending_local_tool_calls)
        ? data.pending_local_tool_calls
        : [];
      for (const item of pendingRaw) {
        const rec = asRecord(item);
        const toolCallId =
          rec && typeof rec.tool_call_id === 'string' ? rec.tool_call_id.trim() : '';
        const name =
          rec && typeof rec.name === 'string' ? rec.name.trim() : '';
        const args = rec ? rec.args : {};
        if (
          !toolCallId ||
          pendingLocalToolCalls.some((entry) => entry.id === toolCallId)
        ) {
          continue;
        }
        pendingLocalToolCalls.push({ id: toolCallId, name, args });
      }

      const baseToolOutputs: Array<{
        callId: string;
        output: string;
        name?: string;
        args?: unknown;
      }> = [];
      const outputsRaw = Array.isArray(data.base_tool_outputs)
        ? data.base_tool_outputs
        : [];
      for (const item of outputsRaw) {
        const rec = asRecord(item);
        const callId =
          rec && typeof rec.call_id === 'string' ? rec.call_id.trim() : '';
        const output =
          rec && typeof rec.output === 'string' ? rec.output : '';
        if (!callId) continue;
        const name =
          rec && typeof rec.name === 'string' ? rec.name.trim() : '';
        baseToolOutputs.push({
          callId,
          output,
          ...(name ? { name } : {}),
          ...(rec && 'args' in rec ? { args: rec.args } : {}),
        });
      }

      const localToolDefinitions: LocalToolDefinitionInput[] = [];
      const localDefsRaw = Array.isArray(data.local_tool_definitions)
        ? data.local_tool_definitions
        : [];
      for (const item of localDefsRaw) {
        const rec = asRecord(item);
        const name =
          rec && typeof rec.name === 'string' ? rec.name.trim() : '';
        const description =
          rec && typeof rec.description === 'string'
            ? rec.description.trim()
            : '';
        const parameters =
          rec && asRecord(rec.parameters)
            ? (rec.parameters as Record<string, unknown>)
            : null;
        if (!name || !description || !parameters || !isValidToolName(name))
          continue;
        localToolDefinitions.push({ name, description, parameters });
      }

      if (pendingLocalToolCalls.length === 0) return null;

      return {
        sequence: event.sequence,
        previousResponseId,
        pendingLocalToolCalls,
        baseToolOutputs,
        localToolDefinitions,
        vscodeCodeAgent: this.deps.normalizeVsCodeCodeAgent(data.vscode_code_agent),
      };
    }

    return null;
  }

  /**
   * Accept a result for a pending local tool call. Records the
   * `tool_call_result` + `status:local_tool_result_received` stream
   * events, collects all collected results for the awaiting state, and
   * returns either `readyToResume:true` with the merged tool outputs +
   * `previousResponseId` for `runAssistantGeneration` continuation, or
   * `readyToResume:false` with `waitingForToolCallIds` when other local
   * tools are still pending.
   *
   * Migrated verbatim from `ChatService.acceptLocalToolResult`
   * (chat-service.ts pre Lot 10). Only differences:
   * (a) `readStreamEvents` → `this.deps.streamBuffer.read`,
   * (b) `getNextSequence` → `this.deps.streamBuffer.getNextSequence`,
   * (c) `writeStreamEvent` → `this.deps.streamBuffer.append`,
   * (d) `this.serializeToolOutput` → module helper `serializeToolOutput`.
   * No model invocation happens here — the mesh port is wired in deps
   * but unused by this method; future lots use it for the actual
   * `runAssistantGeneration` resume that follows this call externally.
   */
  async acceptLocalToolResult(
    options: AcceptLocalToolResultOptions,
  ): Promise<AcceptLocalToolResultResponse> {
    const toolCallId = String(options.toolCallId ?? '').trim();
    if (!toolCallId) {
      throw new Error('toolCallId is required');
    }

    const events = await this.deps.streamBuffer.read(options.assistantMessageId);
    const awaitingState = this.extractAwaitingLocalToolState(events);
    if (!awaitingState) {
      throw new Error('No pending local tool call found for this assistant message');
    }
    if (!awaitingState.pendingLocalToolCalls.some((entry) => entry.id === toolCallId)) {
      throw new Error(`Tool call ${toolCallId} is not pending for this assistant message`);
    }

    const rawResult = options.result;
    const resultObj = asRecord(rawResult);
    const normalizedResult = resultObj
      ? {
          ...(typeof resultObj.status === 'string' ? {} : { status: 'completed' }),
          ...resultObj
        }
      : { status: 'completed', value: rawResult };

    let streamSeq = await this.deps.streamBuffer.getNextSequence(options.assistantMessageId);
    await this.deps.streamBuffer.append(
      options.assistantMessageId,
      'tool_call_result',
      { tool_call_id: toolCallId, result: normalizedResult },
      streamSeq,
      options.assistantMessageId,
    );
    streamSeq += 1;

    await this.deps.streamBuffer.append(
      options.assistantMessageId,
      'status',
      { state: 'local_tool_result_received', tool_call_id: toolCallId },
      streamSeq,
      options.assistantMessageId,
    );

    const followupEvents = await this.deps.streamBuffer.read(options.assistantMessageId, {
      sinceSequence: awaitingState.sequence,
    });
    const pendingSet = new Set(awaitingState.pendingLocalToolCalls.map((entry) => entry.id));
    const collectedByToolCallId = new Map<string, string>();
    for (const event of followupEvents) {
      if (event.eventType !== 'tool_call_result') continue;
      const data = asRecord(event.data);
      if (!data) continue;
      const id =
        typeof data.tool_call_id === 'string' ? data.tool_call_id.trim() : '';
      if (!id || !pendingSet.has(id)) continue;
      const output = serializeToolOutput(data.result);
      collectedByToolCallId.set(id, output);
    }

    const waitingForToolCallIds = awaitingState.pendingLocalToolCalls
      .map((entry) => entry.id)
      .filter((id) => !collectedByToolCallId.has(id));
    if (waitingForToolCallIds.length > 0) {
      return {
        readyToResume: false,
        waitingForToolCallIds,
        localToolDefinitions: awaitingState.localToolDefinitions,
        vscodeCodeAgent: awaitingState.vscodeCodeAgent,
      };
    }

    const dedupedOutputs = new Map<string, string>();
    for (const item of awaitingState.baseToolOutputs) {
      if (!item.callId) continue;
      dedupedOutputs.set(item.callId, item.output);
    }
    for (const id of awaitingState.pendingLocalToolCalls.map((entry) => entry.id)) {
      const output = collectedByToolCallId.get(id);
      if (!output) continue;
      dedupedOutputs.set(id, output);
    }
    const pendingById = new Map(
      awaitingState.pendingLocalToolCalls.map((entry) => [entry.id, entry] as const),
    );
    const baseById = new Map(
      awaitingState.baseToolOutputs.map((entry) => [entry.callId, entry] as const),
    );
    const toolOutputs = Array.from(dedupedOutputs.entries()).map(([callId, output]) => {
      const pending = pendingById.get(callId);
      const base = baseById.get(callId);
      return {
        callId,
        output,
        ...(pending?.name ? { name: pending.name } : base?.name ? { name: base.name } : {}),
        ...(pending ? { args: pending.args } : base && 'args' in base ? { args: base.args } : {}),
      };
    });

    return {
      readyToResume: true,
      waitingForToolCallIds: [],
      localToolDefinitions: awaitingState.localToolDefinitions,
      vscodeCodeAgent: awaitingState.vscodeCodeAgent,
      resumeFrom: {
        previousResponseId: awaitingState.previousResponseId,
        toolOutputs,
      },
    };
  }

  /**
   * Create a checkpoint of the current session state, anchored at a
   * specific message (defaults to the latest message). Composes
   * `MessageStore.listForSession` (read all messages, ordered by
   * sequence) + `CheckpointStore.save` (persist the snapshot under
   * key `${sessionId}#${checkpointId}`).
   *
   * Migrated verbatim from
   * `PostgresChatCheckpointAdapter.createCheckpointForSession`
   * (BR14b Lot 4). Differences are limited to:
   *   (a) `db.select(...).from(chatMessages).where(...).orderBy(...)`
   *       becomes `this.deps.messageStore.listForSession(sessionId)`
   *       which already SELECTs the full column set ordered by
   *       `sequence ASC`;
   *   (b) `db.insert(chatContexts).values(...)` becomes
   *       `this.deps.checkpointStore.save(key, state)` — the adapter
   *       owns the table mapping;
   *   (c) Caller (chat-service.ts) is responsible for the
   *       session-owner authz check (`getSessionForUser`) before
   *       invoking this method; the runtime does not enforce it
   *       because the persistence layer is tenant-agnostic by design.
   */
  async createCheckpoint(
    options: CreateCheckpointOptions,
  ): Promise<ChatCheckpointSummary> {
    const messages = await this.deps.messageStore.listForSession(
      options.sessionId,
    );

    if (messages.length === 0) {
      throw new Error('Cannot create checkpoint on an empty session');
    }

    const anchorMessage =
      (options.anchorMessageId
        ? messages.find((message) => message.id === options.anchorMessageId)
        : null) ?? messages[messages.length - 1];
    if (!anchorMessage) throw new Error('Anchor message not found');

    const anchorSequence = Number(anchorMessage.sequence ?? 0);
    if (!Number.isFinite(anchorSequence) || anchorSequence <= 0) {
      throw new Error('Invalid checkpoint anchor sequence');
    }

    const snapshotMessages = messages
      .filter((message) => Number(message.sequence ?? 0) <= anchorSequence)
      .map(snapshotMessageFromRow);

    const checkpointId = randomUUID();
    const now = new Date();
    const title =
      typeof options.title === 'string' && options.title.trim().length > 0
        ? options.title.trim()
        : `Checkpoint #${anchorSequence}`;

    const snapshot: ChatStateSnapshot = {
      id: checkpointId,
      title,
      anchorMessageId: anchorMessage.id,
      anchorSequence,
      messageCount: snapshotMessages.length,
      messages: snapshotMessages,
    };

    const state: ChatState = {
      sessionId: options.sessionId,
      snapshot,
      modifications: {
        action: 'checkpoint_create',
        anchorMessageId: anchorMessage.id,
        anchorSequence,
      },
      createdAt: now.toISOString(),
    };

    await this.deps.checkpointStore.save(
      encodeChatCheckpointKey(options.sessionId, checkpointId),
      state,
    );

    return {
      id: checkpointId,
      title,
      anchorMessageId: anchorMessage.id,
      anchorSequence,
      messageCount: snapshotMessages.length,
      createdAt: now.toISOString(),
    };
  }

  /**
   * List checkpoints for a session, newest first. Composes
   * `CheckpointStore.list(prefix=sessionId, limit)` to retrieve the
   * meta rows and `CheckpointStore.load(key)` per row to reconstruct
   * the `ChatCheckpointSummary` shape (title, anchorMessageId,
   * anchorSequence, messageCount) that the chat surface expects.
   *
   * Migrated verbatim from
   * `PostgresChatCheckpointAdapter.listCheckpointsForSession`
   * (BR14b Lot 4). Difference: the previous implementation issued a
   * single SQL SELECT that returned the snapshot JSONB inline.
   * The generic port's `list` returns only `CheckpointMeta` (key +
   * version + timestamps); reconstructing the rich summary requires
   * a follow-up `load(key)` per row. For the chat domain's default
   * `limit=20` cap this is acceptable; if a future workload reveals
   * a hot path we can revisit by extending the port or introducing
   * a dedicated `summaries(prefix, limit)` overload.
   *
   * Behavior preservation: output shape is byte-for-byte identical
   * to the legacy implementation; ordering (newest first by
   * createdAt) is preserved by the adapter's `list` ORDER BY.
   */
  async listCheckpoints(
    options: ListCheckpointsOptions,
  ): Promise<ChatCheckpointSummary[]> {
    const metas = await this.deps.checkpointStore.list(
      options.sessionId,
      options.limit,
    );

    const summaries: ChatCheckpointSummary[] = [];
    for (const meta of metas) {
      const loaded = await this.deps.checkpointStore.load(meta.key);
      if (!loaded) continue;
      summaries.push(summaryFromSnapshot(loaded.state.snapshot, meta.createdAt));
    }
    return summaries;
  }

  /**
   * Restore a checkpoint by truncating all messages strictly above
   * its anchor sequence and touching the session `updatedAt`.
   * Composes `CheckpointStore.load` (read snapshot to extract
   * anchorSequence) + `MessageStore.deleteAfterSequence` (truncate)
   * + `SessionStore.touchUpdatedAt` (bump session timestamp).
   *
   * Migrated verbatim from
   * `PostgresChatCheckpointAdapter.restoreCheckpointForSession`
   * (BR14b Lot 4). Differences are limited to:
   *   (a) `db.select(...).from(chatContexts).where(id+sessionId+type)`
   *       becomes `this.deps.checkpointStore.load(key)`;
   *   (b) `db.delete(chatMessages).where(sessionId+sequence>anchor)`
   *       becomes `this.deps.messageStore.deleteAfterSequence(...)`;
   *   (c) `db.update(chatSessions).set({updatedAt})` becomes
   *       `this.deps.sessionStore.touchUpdatedAt(sessionId)`;
   *   (d) The `removedMessages` count: the legacy adapter used
   *       `RETURNING { id }` to count deleted rows. The
   *       `MessageStore.deleteAfterSequence` port returns void; we
   *       compute the count up-front by listing messages with
   *       `sequence > anchorSequence` via `listForSession` then
   *       filtering — same value, one extra read. Chat sessions are
   *       small (tens to low hundreds of messages typically) so the
   *       cost is negligible. This preserves the public API's
   *       `removedMessages` contract.
   */
  async restoreCheckpoint(
    options: RestoreCheckpointOptions,
  ): Promise<RestoreCheckpointResult> {
    const key = encodeChatCheckpointKey(
      options.sessionId,
      options.checkpointId,
    );
    const loaded = await this.deps.checkpointStore.load(key);
    if (!loaded) throw new Error('Checkpoint not found');

    const restoredToSequence = Number(loaded.state.snapshot.anchorSequence ?? 0);
    if (!Number.isFinite(restoredToSequence) || restoredToSequence <= 0) {
      throw new Error('Invalid checkpoint payload');
    }

    const messages = await this.deps.messageStore.listForSession(
      options.sessionId,
    );
    const removedMessages = messages.filter(
      (message) => Number(message.sequence ?? 0) > restoredToSequence,
    ).length;

    await this.deps.messageStore.deleteAfterSequence(
      options.sessionId,
      restoredToSequence,
    );
    await this.deps.sessionStore.touchUpdatedAt(options.sessionId);

    return {
      checkpointId: options.checkpointId,
      restoredToSequence,
      removedMessages,
    };
  }

  /**
   * BR14b Lot 17 — public wrapper around the `resolveModelSelection`
   * callback (Lot 12) so that callers outside the runtime (notably
   * `ChatService.runAssistantGeneration`) can reuse the same bundled
   * `{aiSettings + catalog + inference + default-selection}` resolution
   * without re-importing `settingsService` / `model-catalog` helpers.
   *
   * Return shape is the snake_case `{provider_id, model_id}` pair from
   * `ModelSelectionPair` (mirrors `resolveDefaultSelection` byte-for-byte).
   */
  async resolveModelSelection(
    input: Parameters<ChatRuntimeDeps['resolveModelSelection']>[0],
  ): ReturnType<ChatRuntimeDeps['resolveModelSelection']> {
    return this.deps.resolveModelSelection(input);
  }

  /**
   * Retry an existing user message: re-resolve `{providerId, model}`
   * from caller overrides + AI settings, truncate every message above
   * the retried sequence, insert a fresh assistant placeholder, and
   * touch the session `updatedAt`. The caller (route) then drives the
   * follow-up generation against `assistantMessageId`.
   *
   * Migrated verbatim from `ChatService.retryUserMessage` (chat-service.ts
   * pre-Lot 12). Differences are limited to:
   *   (a) `this.getMessageForUser` → `this.deps.messageStore.findIdentityForUser`;
   *   (b) `settingsService.getAISettings` + `getModelCatalogPayload` +
   *       `inferProviderFromModelIdWithLegacy` + `resolveDefaultSelection`
   *       → single `this.deps.resolveModelSelection` callback;
   *   (c) `postgresChatMessageStore.deleteAfterSequence` →
   *       `this.deps.messageStore.deleteAfterSequence`;
   *   (d) `createId()` → inlined `randomUUID()` (chat-core already
   *       imports it at the top of the file);
   *   (e) `postgresChatMessageStore.insertMany` →
   *       `this.deps.messageStore.insertMany`;
   *   (f) `postgresChatSessionStore.touchUpdatedAt` →
   *       `this.deps.sessionStore.touchUpdatedAt`.
   *
   * Truncate semantic preserved: `deleteAfterSequence` removes every
   * message with `sequence > msg.sequence`, so the retried user message
   * is **kept** (it is at exactly `msg.sequence`); the assistant
   * placeholder lands at `msg.sequence + 1`.
   */
  async retryUserMessage(
    options: RetryUserMessageOptions,
  ): Promise<RetryUserMessageResult> {
    const msg = await this.deps.messageStore.findIdentityForUser(
      options.messageId,
      options.userId,
    );
    if (!msg) throw new Error('Message not found');
    if (msg.role !== 'user') throw new Error('Only user messages can be retried');

    const resolvedSelection = await this.deps.resolveModelSelection({
      userId: options.userId,
      providerId: options.providerId,
      model: options.model,
    });
    const selectedModel = resolvedSelection.model_id;
    const selectedProviderId = resolvedSelection.provider_id;

    await this.deps.messageStore.deleteAfterSequence(msg.sessionId, msg.sequence);

    const assistantMessageId = randomUUID();
    const assistantSeq = msg.sequence + 1;

    await this.deps.messageStore.insertMany([
      {
        id: assistantMessageId,
        sessionId: msg.sessionId,
        role: 'assistant',
        content: null,
        toolCalls: null,
        toolCallId: null,
        reasoning: null,
        model: selectedModel,
        promptId: null,
        promptVersionId: null,
        sequence: assistantSeq,
        createdAt: new Date(),
      },
    ]);

    await this.deps.sessionStore.touchUpdatedAt(msg.sessionId);

    return {
      sessionId: msg.sessionId,
      userMessageId: options.messageId,
      assistantMessageId,
      streamId: assistantMessageId,
      providerId: selectedProviderId,
      model: selectedModel,
    };
  }

  /**
   * Create the user message + the assistant placeholder (same session).
   * The streamId for the chat SSE equals the assistant message id.
   *
   * Reuses (or creates) a chat session aligned with the desired
   * workspace, updates the session primary context if the inbound
   * `primaryContextType`/`primaryContextId` differs from the persisted
   * pair, resolves `{providerId, model}` via the `resolveModelSelection`
   * callback, computes the next sequence, then inserts both messages
   * atomically in one batch followed by a session `touchUpdatedAt`.
   *
   * Migrated verbatim from
   * `ChatService.createUserMessageWithAssistantPlaceholder`
   * (chat-service.ts pre-Lot 12). Differences are limited to:
   *   (a) `this.getSessionForUser` → `this.deps.sessionStore.findForUser`;
   *   (b) `this.createSession` → `this.deps.sessionStore.create`
   *       (ChatService.createSession is itself a one-line delegate);
   *   (c) `isChatContextType` → `this.deps.isChatContextType` callback;
   *   (d) `postgresChatSessionStore.updateContext` →
   *       `this.deps.sessionStore.updateContext`;
   *   (e) `settingsService.getAISettings` + `getModelCatalogPayload` +
   *       `inferProviderFromModelIdWithLegacy` + `resolveDefaultSelection`
   *       → `this.deps.resolveModelSelection`;
   *   (f) `this.getNextMessageSequence` →
   *       `this.deps.messageStore.getNextSequence`;
   *   (g) `createId()` → `randomUUID()`;
   *   (h) `this.normalizeMessageContexts` →
   *       `this.deps.normalizeMessageContexts`;
   *   (i) `postgresChatMessageStore.insertMany` →
   *       `this.deps.messageStore.insertMany`;
   *   (j) `postgresChatSessionStore.touchUpdatedAt` →
   *       `this.deps.sessionStore.touchUpdatedAt`.
   *
   * Placeholder lifecycle preserved: the assistant message is inserted
   * with `content=null` / `reasoning=null` / `model=selectedModel` so
   * downstream callers (route + queue manager) can stream-fill it via
   * `runAssistantGeneration` and then finalize via
   * `finalizeAssistantMessageFromStream`. The placeholder always lands
   * at `userSeq + 1` so the pair is contiguous in the message sequence.
   */
  async createUserMessageWithAssistantPlaceholder(
    input: RuntimeCreateChatMessageInput,
  ): Promise<CreateUserMessageResult> {
    const desiredWorkspaceId = input.workspaceId ?? null;
    const existing = input.sessionId
      ? await this.deps.sessionStore.findForUser(input.sessionId, input.userId)
      : null;
    const existingId =
      existing && typeof (existing as { id?: unknown }).id === 'string'
        ? (existing as { id: string }).id
        : null;
    const existingWorkspaceId =
      existing && typeof (existing as { workspaceId?: unknown }).workspaceId === 'string'
        ? ((existing as { workspaceId: string }).workspaceId as string)
        : null;
    const sessionId =
      existingId && existingWorkspaceId === desiredWorkspaceId
        ? existingId
        : (await this.deps.sessionStore.create({
            userId: input.userId,
            workspaceId: desiredWorkspaceId,
            primaryContextType: input.primaryContextType ?? null,
            primaryContextId: input.primaryContextId ?? null,
            title: input.sessionTitle ?? null,
          })).sessionId;
    const nextContextType = this.deps.isChatContextType(input.primaryContextType)
      ? (input.primaryContextType as string)
      : null;
    const nextContextId =
      typeof input.primaryContextId === 'string' ? input.primaryContextId.trim() : '';

    if (nextContextType && nextContextId) {
      const shouldUpdateContext =
        !existing ||
        existing.primaryContextType !== nextContextType ||
        existing.primaryContextId !== nextContextId;
      if (shouldUpdateContext) {
        await this.deps.sessionStore.updateContext(sessionId, {
          primaryContextType: nextContextType,
          primaryContextId: nextContextId,
        });
      }
    }

    // Provider/model selection (request overrides > inferred by model id > workspace defaults).
    const resolvedSelection = await this.deps.resolveModelSelection({
      userId: input.userId,
      providerId: input.providerId,
      model: input.model,
    });
    const selectedProviderId = resolvedSelection.provider_id;
    const selectedModel = resolvedSelection.model_id;
    const userSeq = await this.deps.messageStore.getNextSequence(sessionId);
    const assistantSeq = userSeq + 1;

    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();

    const messageContexts = this.deps.normalizeMessageContexts(input);

    await this.deps.messageStore.insertMany([
      {
        id: userMessageId,
        sessionId,
        role: 'user',
        content: input.content,
        toolCalls: null,
        toolCallId: null,
        reasoning: null,
        model: null,
        promptId: null,
        promptVersionId: null,
        contexts: messageContexts.length > 0 ? messageContexts : null,
        sequence: userSeq,
        createdAt: new Date(),
      },
      {
        id: assistantMessageId,
        sessionId,
        role: 'assistant',
        content: null,
        toolCalls: null,
        toolCallId: null,
        reasoning: null,
        model: selectedModel,
        promptId: null,
        promptVersionId: null,
        contexts: null,
        sequence: assistantSeq,
        createdAt: new Date(),
      },
    ]);

    // Touch session updatedAt
    await this.deps.sessionStore.touchUpdatedAt(sessionId);

    return {
      sessionId,
      userMessageId,
      assistantMessageId,
      streamId: assistantMessageId,
      providerId: selectedProviderId,
      model: selectedModel,
    };
  }

  /**
   * BR14b Lot 13 — verbatim port of `ChatService.setMessageFeedback`.
   * Validates the message belongs to the user, ensures the role is
   * `assistant` (feedback is only allowed on assistant messages), then
   * delegates feedback association to the MessageStore port.
   *
   * Differences from the pre-Lot 13 chat-service body are limited to:
   *   (a) `this.getMessageForUser` → `this.deps.messageStore.findIdentityForUser`;
   *   (b) `postgresChatMessageStore.setFeedback` → `this.deps.messageStore.setFeedback`.
   */
  async setMessageFeedback(options: {
    messageId: string;
    userId: string;
    vote: 'up' | 'down' | 'clear';
  }) {
    const msg = await this.deps.messageStore.findIdentityForUser(
      options.messageId,
      options.userId,
    );
    if (!msg) throw new Error('Message not found');
    if (msg.role !== 'assistant') throw new Error('Feedback is only allowed on assistant messages');

    return this.deps.messageStore.setFeedback(
      options.messageId,
      options.userId,
      options.vote,
    );
  }

  /**
   * BR14b Lot 13 — verbatim port of `ChatService.updateUserMessageContent`.
   * Validates the message belongs to the user, ensures the role is `user`
   * (only user messages can be edited), updates the content via the
   * MessageStore port, then touches the parent session `updatedAt`
   * timestamp via the SessionStore port.
   *
   * Differences from the pre-Lot 13 chat-service body are limited to:
   *   (a) `this.getMessageForUser` → `this.deps.messageStore.findIdentityForUser`;
   *   (b) `postgresChatMessageStore.updateUserContent` → `this.deps.messageStore.updateUserContent`;
   *   (c) `postgresChatSessionStore.touchUpdatedAt` → `this.deps.sessionStore.touchUpdatedAt`.
   */
  async updateUserMessageContent(options: {
    messageId: string;
    userId: string;
    content: string;
  }) {
    const msg = await this.deps.messageStore.findIdentityForUser(
      options.messageId,
      options.userId,
    );
    if (!msg) throw new Error('Message not found');
    if (msg.role !== 'user') throw new Error('Only user messages can be edited');

    await this.deps.messageStore.updateUserContent(options.messageId, options.content);

    await this.deps.sessionStore.touchUpdatedAt(msg.sessionId);

    return { messageId: options.messageId };
  }

  /**
   * BR14b Lot 14a — verbatim port of `ChatService.listMessages`.
   * Returns the ordered message list (with feedback votes) and the
   * hydrated todoRuntime payload for the session. Authz check
   * (`Session not found`) preserved at the runtime entry; persistence
   * delegated to the `SessionStore` + `MessageStore` ports; todoRuntime
   * hydration delegated to the optional
   * `hydrateMessagesWithTodoRuntime` callback. When the callback is
   * undefined the runtime returns `todoRuntime: null`, matching the
   * legacy behavior of sessions without an addressable workspace.
   *
   * Differences from the pre-Lot 14a chat-service body are limited to:
   *   (a) `this.getSessionForUser` → `this.deps.sessionStore.findForUser`;
   *   (b) `postgresChatMessageStore.listForSessionWithFeedback` →
   *       `this.deps.messageStore.listForSessionWithFeedback`;
   *   (c) the `resolveSessionWorkspaceId` + `getWorkspaceRole` +
   *       `todoOrchestrationService.getSessionTodoRuntime` triplet →
   *       `this.deps.hydrateMessagesWithTodoRuntime({ session, userId })`.
   */
  async listMessages(
    sessionId: string,
    userId: string,
  ): Promise<{
    messages: ChatMessageWithFeedback[];
    todoRuntime: Record<string, unknown> | null;
  }> {
    const session = await this.deps.sessionStore.findForUser(sessionId, userId);
    if (!session) throw new Error('Session not found');

    const messages = await this.deps.messageStore.listForSessionWithFeedback(
      sessionId,
      userId,
    );

    const todoRuntime: Record<string, unknown> | null = this.deps
      .hydrateMessagesWithTodoRuntime
      ? await this.deps.hydrateMessagesWithTodoRuntime({ session, userId })
      : null;

    return {
      messages,
      todoRuntime,
    };
  }

  /**
   * BR14b Lot 14b — verbatim port of `ChatService.getSessionBootstrap`.
   * Composes `SessionStore.findForUser` (authz precheck) +
   * `this.listMessages` (Lot 14a) + `this.listCheckpoints` (Lot 11) +
   * `deps.resolveSessionWorkspaceId` + `deps.listSessionDocuments` +
   * `deps.listAssistantDetailsByMessageId` callbacks (Lot 14b).
   *
   * Differences from the pre-Lot 14b chat-service body are limited to:
   *   (a) `this.getSessionForUser` → `this.deps.sessionStore.findForUser`;
   *   (b) `this.listMessages` → `this.listMessages` (runtime own method);
   *   (c) `this.listCheckpoints({sessionId, userId, limit})` →
   *       `this.listCheckpoints({sessionId, limit})` because the runtime
   *       method does not re-do the authz check; the composer guards
   *       upfront via `findForUser`;
   *   (d) `this.resolveSessionWorkspaceId` →
   *       `this.deps.resolveSessionWorkspaceId`;
   *   (e) `this.listSessionDocuments` → `this.deps.listSessionDocuments`;
   *   (f) `this.listAssistantDetailsByMessageId` →
   *       `this.deps.listAssistantDetailsByMessageId`.
   */
  async getSessionBootstrap(
    options: GetSessionBootstrapOptions,
  ): Promise<GetSessionBootstrapResult> {
    const session = await this.deps.sessionStore.findForUser(
      options.sessionId,
      options.userId,
    );
    if (!session) throw new Error('Session not found');

    const [{ messages, todoRuntime }, checkpoints, workspaceId] = await Promise.all([
      this.listMessages(options.sessionId, options.userId),
      this.listCheckpoints({
        sessionId: options.sessionId,
        limit: 20,
      }),
      this.deps.resolveSessionWorkspaceId(session, options.userId),
    ]);

    const documents = await this.deps.listSessionDocuments({
      sessionId: options.sessionId,
      workspaceId,
    });
    const assistantMessageIds = messages
      .filter((message) => message.role === 'assistant')
      .map((message) => String(message.id ?? '').trim())
      .filter((messageId) => messageId.length > 0);
    const assistantDetailsByMessageId =
      await this.deps.listAssistantDetailsByMessageId(assistantMessageIds);

    return {
      messages,
      todoRuntime,
      checkpoints,
      documents,
      assistantDetailsByMessageId,
    };
  }

  /**
   * BR14b Lot 14b — verbatim port of `ChatService.getSessionHistory`.
   * Composes the same persistence pieces as `getSessionBootstrap` plus
   * the pure history projection helpers
   * (`buildChatHistoryTimeline` + `compactChatHistoryTimelineForSummary`)
   * moved into `packages/chat-core/src/history.ts` in the same lot.
   *
   * Differences from the pre-Lot 14b chat-service body match
   * `getSessionBootstrap` plus:
   *   (g) `buildChatHistoryTimeline` /
   *       `compactChatHistoryTimelineForSummary` resolve from
   *       `./history.js` (chat-core) instead of `./chat-session-history`
   *       (the api re-export shim keeps existing api-side callers
   *       working).
   */
  async getSessionHistory(
    options: GetSessionHistoryOptions,
  ): Promise<GetSessionHistoryResult> {
    const session = await this.deps.sessionStore.findForUser(
      options.sessionId,
      options.userId,
    );
    if (!session) throw new Error('Session not found');

    const [{ messages, todoRuntime }, checkpoints, workspaceId] = await Promise.all([
      this.listMessages(options.sessionId, options.userId),
      this.listCheckpoints({
        sessionId: options.sessionId,
        limit: 20,
      }),
      this.deps.resolveSessionWorkspaceId(session, options.userId),
    ]);

    const documents = await this.deps.listSessionDocuments({
      sessionId: options.sessionId,
      workspaceId,
    });
    const assistantMessageIds = messages
      .filter((message) => message.role === 'assistant')
      .map((message) => String(message.id ?? '').trim())
      .filter((messageId) => messageId.length > 0);
    const assistantDetailsByMessageId =
      await this.deps.listAssistantDetailsByMessageId(assistantMessageIds);
    const eventMap = new Map<string, ChatHistoryStreamEvent[]>();
    for (const [messageId, events] of Object.entries(assistantDetailsByMessageId)) {
      eventMap.set(messageId, events as ChatHistoryStreamEvent[]);
    }
    const projectedItems = buildChatHistoryTimeline(
      messages as ChatHistoryMessage[],
      eventMap,
    );
    const items =
      options.detailMode === 'full'
        ? projectedItems
        : compactChatHistoryTimelineForSummary(projectedItems);

    return {
      sessionId: options.sessionId,
      title: session.title ?? null,
      todoRuntime,
      checkpoints,
      documents,
      items: [...items].reverse(),
    };
  }

  /**
   * BR14b Lot 14b — verbatim port of
   * `ChatService.getMessageRuntimeDetails`. Composes
   * `MessageStore.findDetailedForUser` (authz + role precheck) +
   * `this.listMessages` (Lot 14a) +
   * `deps.listAssistantDetailsByMessageId` callback (Lot 14b) + the
   * pure projection helpers from `./history.js`.
   *
   * Differences from the pre-Lot 14b chat-service body are limited to:
   *   (a) `this.getDetailedMessageForUser` →
   *       `this.deps.messageStore.findDetailedForUser`;
   *   (b) `this.listMessages` → `this.listMessages` (runtime own method);
   *   (c) `this.listAssistantDetailsByMessageId` →
   *       `this.deps.listAssistantDetailsByMessageId`;
   *   (d) `buildChatHistoryTimeline` /
   *       `buildAssistantMessageHistoryDetails` resolve from
   *       `./history.js` (chat-core) instead of `./chat-session-history`.
   */
  async getMessageRuntimeDetails(
    options: GetMessageRuntimeDetailsOptions,
  ): Promise<GetMessageRuntimeDetailsResult> {
    const message = await this.deps.messageStore.findDetailedForUser(
      options.messageId,
      options.userId,
    );
    if (!message) throw new Error('Message not found');
    if (message.role !== 'assistant') {
      throw new Error('Runtime details only exist for assistant messages');
    }

    const { messages } = await this.listMessages(
      message.sessionId,
      options.userId,
    );
    const details = await this.deps.listAssistantDetailsByMessageId([options.messageId]);
    const events = (details[options.messageId] ?? []) as ChatHistoryStreamEvent[];
    const eventMap = new Map<string, ChatHistoryStreamEvent[]>();
    eventMap.set(options.messageId, events);
    const projected = buildChatHistoryTimeline(
      messages as ChatHistoryMessage[],
      eventMap,
    );
    const firstIndex = projected.findIndex(
      (item) => String(item.message.id ?? '').trim() === options.messageId,
    );
    const lastIndex = (() => {
      for (let index = projected.length - 1; index >= 0; index -= 1) {
        if (String(projected[index]?.message.id ?? '').trim() === options.messageId) {
          return index;
        }
      }
      return -1;
    })();
    const items =
      firstIndex >= 0 && lastIndex >= firstIndex
        ? projected.slice(firstIndex, lastIndex + 1)
        : buildAssistantMessageHistoryDetails(
            message as ChatHistoryMessage,
            events,
          );

    return {
      messageId: options.messageId,
      items,
    };
  }

  /**
   * BR14b Lot 15 — first slice of `runAssistantGeneration` decomposition.
   *
   * Verbatim port of the precheck block that opens
   * `ChatService.runAssistantGeneration`: session lookup +
   * workspace resolution + workspace-access flags + contexts
   * normalisation + messages load + assistant-row precheck +
   * conversation projection + last-user-message extraction.
   *
   * Differences from the pre-Lot 15 chat-service body are limited to:
   *   (a) `this.getSessionForUser` → `this.deps.sessionStore.findForUser`
   *       (already a thin wrapper post Lot 8);
   *   (b) the inline `ensureWorkspaceForUser` + `session.workspaceId`
   *       fallback collapses to `deps.resolveSessionWorkspaceId(session,
   *       userId)` which has the identical body (Lot 14b);
   *   (c) the inline `isWorkspaceDeleted` + `hasWorkspaceRole` +
   *       `getWorkspaceRole` trio collapses to
   *       `deps.resolveWorkspaceAccess({ userId, workspaceId })` which
   *       bundles the same three calls in the same order (Lot 15);
   *   (d) the inline `normalizeContexts` helper uses
   *       `deps.isChatContextType` (Lot 12) instead of the module-level
   *       guard — same membership check.
   *
   * The remainder of `runAssistantGeneration` (title generation,
   * documents/comments blocks, tool selection, system prompt build,
   * provider/model resolution, reasoning effort eval, tool loop,
   * continuation, etc.) STAYS in chat-service.ts and consumes the
   * returned `AssistantRunContext` field by field. Subsequent lots
   * (16+) migrate those slices one by one.
   */
  async prepareAssistantRun(
    options: PrepareAssistantRunOptions,
  ): Promise<AssistantRunContext> {
    const session = await this.deps.sessionStore.findForUser(
      options.sessionId,
      options.userId,
    );
    if (!session) throw new Error('Session not found');

    const sessionWorkspaceId = await this.deps.resolveSessionWorkspaceId(
      session,
      options.userId,
    );
    if (!sessionWorkspaceId) throw new Error('Workspace not found for user');

    const { readOnly, canWrite, currentUserRole } =
      await this.deps.resolveWorkspaceAccess({
        userId: options.userId,
        workspaceId: sessionWorkspaceId,
      });

    const normalizeContexts = (
      items?: ReadonlyArray<{ contextType: string; contextId: string }>,
    ): Array<{ contextType: string; contextId: string }> => {
      const out: Array<{ contextType: string; contextId: string }> = [];
      for (const item of items ?? []) {
        const type = item?.contextType;
        const id = (item?.contextId || '').trim();
        if (!this.deps.isChatContextType(type) || !id) continue;
        const key = `${type}:${id}`;
        if (out.some((c) => `${c.contextType}:${c.contextId}` === key)) continue;
        out.push({ contextType: type, contextId: id });
      }
      return out;
    };
    const contextsOverride = normalizeContexts(options.contexts);
    const focusContext = contextsOverride[0] ?? null;

    // Charger messages (sans inclure le placeholder assistant)
    const messages = await this.deps.messageStore.listForSession(
      options.sessionId,
    );

    const assistantRow = messages.find((m) => m.id === options.assistantMessageId);
    if (!assistantRow) throw new Error('Assistant message not found');

    const conversation = messages
      .filter((m) => m.sequence < assistantRow.sequence)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content ?? '',
      }));
    const lastUserMessage =
      [...conversation].reverse().find((m) => m.role === 'user')?.content?.trim() || '';

    return {
      session,
      sessionWorkspaceId,
      readOnly,
      canWrite,
      currentUserRole,
      contextsOverride,
      focusContext,
      messages,
      assistantRow,
      conversation,
      lastUserMessage,
    };
  }

  /**
   * BR14b Lot 16a — migrate the title-generation side effect of
   * `runAssistantGeneration` (chat-service.ts pre Lot 16, lines
   * 1889-1907) into the runtime. Short-circuits when the session
   * already has a title or the last user message is empty, then
   * delegates to `deps.ensureSessionTitle` for the
   * `generateSessionTitle` + `SessionStore.updateTitle` +
   * `notifyWorkspaceEvent` chain. Returns the persisted title (or
   * `null` when nothing was done) so callers can observe what
   * happened.
   *
   * The remainder of Slice B (context blocks + tool catalog +
   * system prompt build) migrates in Lot 16b through a separate
   * `buildSystemPrompt` callback + `prepareSystemPrompt` method.
   * Keeping title-gen as its own atomic method (rather than
   * inlining it inside `prepareSystemPrompt`) preserves the
   * idempotent contract — callers may invoke it independently
   * (e.g. retry flow, queue-worker resume).
   */
  async ensureSessionTitle(
    options: EnsureSessionTitleOptions,
  ): Promise<string | null> {
    const { session, sessionWorkspaceId, focusContext, lastUserMessage } =
      options;
    if (session.title) return null;
    if (!lastUserMessage.trim()) return null;
    if (!this.deps.ensureSessionTitle) return null;
    return this.deps.ensureSessionTitle({
      session,
      sessionWorkspaceId,
      focusContext,
      lastUserMessage,
    });
  }

  /**
   * BR14b Lot 16b — wrap the system-prompt build chain (Slice B body,
   * 605 lines pre-Lot 16b: lines 1936-2540 of chat-service.ts) as a
   * runtime orchestration step. The body lives chat-service-side
   * (`buildSystemPromptInternal`) because it imports drizzle, db
   * schema, the tool catalog, the chat prompt registry, the VsCode
   * prompt template registry, todo orchestration, tab registry, and
   * workspace-service — none of which chat-core may import. The
   * runtime forwards the typed `AssistantRunContext` (Lot 15) plus the
   * caller-side options (`requestedTools` / `localToolDefinitions` /
   * `vscodeCodeAgent`) to the `deps.buildSystemPrompt` callback, and
   * returns the result struct verbatim.
   *
   * Keeping this method on the runtime (rather than letting the
   * service call its own private method directly) preserves the
   * orchestration boundary: `runAssistantGeneration` now drives the
   * runtime as the single coordination point for both Slice A
   * (precheck), Slice B leading (title-gen) and Slice B body (system
   * prompt build). Lots 17+ will extend the runtime with the remaining
   * slices (provider/model resolution, reasoning effort eval, tool
   * loop, continuation, etc.).
   */
  async prepareSystemPrompt(
    ctx: AssistantRunContext,
    options: PrepareSystemPromptOptions & {
      readonly userId: string;
      readonly sessionId: string;
    },
  ): Promise<BuildSystemPromptResult> {
    if (!this.deps.buildSystemPrompt) {
      throw new Error(
        'ChatRuntime.prepareSystemPrompt requires deps.buildSystemPrompt',
      );
    }
    return this.deps.buildSystemPrompt({
      userId: options.userId,
      sessionId: options.sessionId,
      session: ctx.session,
      sessionWorkspaceId: ctx.sessionWorkspaceId,
      readOnly: ctx.readOnly,
      currentUserRole: ctx.currentUserRole,
      contextsOverride: ctx.contextsOverride,
      focusContext: ctx.focusContext,
      lastUserMessage: ctx.lastUserMessage,
      requestedTools: options.requestedTools,
      localToolDefinitions: options.localToolDefinitions,
      vscodeCodeAgent: options.vscodeCodeAgent,
    });
  }

  /**
   * BR14b Lot 18 — wrapper around the `evaluateReasoningEffort` callback
   * that bundles the 98-line evaluator block previously embedded in
   * `ChatService.runAssistantGeneration`. When the dep is not wired
   * (test harness, minimal runtime), the wrapper returns the same
   * fallback shape the legacy code produced when the evaluator decided
   * not to run: `{ shouldEvaluate: false, effortLabel: 'medium',
   * evaluatedBy: 'fallback' }` AND emits no stream events (mirrors the
   * `if (modelSupportsReasoning(selectedModel))`-gated branch in the
   * legacy code, which only wrote the two status events when the model
   * was a reasoning model).
   *
   * BR14b Lot 20 — the two `status` events that previously bracketed
   * the legacy block (`reasoning_effort_eval_failed` +
   * `reasoning_effort_selected`) are now emitted INSIDE this method,
   * using `deps.streamSequencer.allocate(input.streamId)` for sequence
   * allocation and `deps.streamBuffer.append(...)` for persistence.
   * Concrete proof of the StreamSequencer port contract: the caller
   * no longer mutates a shared `streamSeq` cursor around this call —
   * it can re-sync via `deps.streamSequencer.peek(streamId)` once the
   * runtime returns.
   *
   * Order preserved byte-for-byte vs the legacy code:
   *   1. callback runs (or fallback short-circuits when undefined)
   *   2. on `failure`: append `status` event
   *      `{ state: 'reasoning_effort_eval_failed', message }` at the
   *      next sequence
   *   3. on `shouldEvaluate=true`: append `status` event
   *      `{ state: 'reasoning_effort_selected', effort, by }` at the
   *      next sequence
   *
   * When `shouldEvaluate=false` (callback unwired or non-reasoning
   * model), NO event is appended — mirrors the legacy
   * `modelSupportsReasoning` guard which skipped both status writes.
   */
  async evaluateReasoningEffort(
    input: EvaluateReasoningEffortInput,
  ): Promise<ReasoningEffortEvaluation> {
    const evaluation: ReasoningEffortEvaluation = this.deps
      .evaluateReasoningEffort
      ? await this.deps.evaluateReasoningEffort(input)
      : {
          shouldEvaluate: false,
          effortLabel: 'medium',
          evaluatedBy: 'fallback',
          evaluatorModel: null,
        };

    // BR14b Lot 20 — reclaim the 2 caller-side `writeStreamEvent` calls.
    // Only emit when the model supports reasoning (legacy guard).
    if (evaluation.shouldEvaluate) {
      if (evaluation.failure) {
        const failedSeq = await this.deps.streamSequencer.allocate(
          input.streamId,
        );
        await this.deps.streamBuffer.append(
          input.streamId,
          'status',
          {
            state: 'reasoning_effort_eval_failed',
            message: evaluation.failure.message,
          },
          failedSeq,
          input.streamId,
        );
      }
      const selectedSeq = await this.deps.streamSequencer.allocate(
        input.streamId,
      );
      await this.deps.streamBuffer.append(
        input.streamId,
        'status',
        {
          state: 'reasoning_effort_selected',
          effort: evaluation.effortLabel,
          by: evaluation.evaluatedBy,
        },
        selectedSeq,
        input.streamId,
      );
    }

    return evaluation;
  }

  /**
   * BR14b Lot 20 — slim wrapper over `deps.streamSequencer.allocate`.
   * Exposed because `deps` is `private readonly`. Mirrors the
   * `ChatRuntime.resolveModelSelection` (Lot 17) and
   * `ChatRuntime.acceptLocalToolResult` (Lot 10) public-wrapper pattern.
   * Used by the tool-loop migration (Lots 21+) which still needs to
   * advance the shared `streamSeq` cursor caller-side while the
   * remaining loop body lives in chat-service.ts.
   */
  async allocateStreamSequence(streamId: string): Promise<number> {
    return this.deps.streamSequencer.allocate(streamId);
  }

  /**
   * BR14b Lot 20 — slim wrapper over `deps.streamSequencer.peek`.
   * Used by `runAssistantGeneration` after `evaluateReasoningEffort`
   * runs to re-sync the local `streamSeq` cursor with the runtime
   * (which appended 1 or 2 events internally and consumed 1 or 2
   * sequence slots).
   */
  async peekStreamSequence(streamId: string): Promise<number> {
    return this.deps.streamSequencer.peek(streamId);
  }

  /**
   * BR14b Lot 21a — initialize the tool-loop-local state for
   * `runAssistantGeneration`. Mirrors the 40-line loop-setup block
   * (chat-service.ts lines 2896-2934 + 3001 pre-Lot 21a) verbatim —
   * every field initial value matches the inline declaration. The
   * call also performs the initial `getNextSequence` lookup against
   * the `StreamBuffer` port so the returned `streamSeq` starts at
   * the same cursor value the caller would have computed inline.
   *
   * Behaviour preservation is the absolute contract: the returned
   * state is byte-identical to the inline block pre-Lot 21a (apart
   * from the field aggregation into a single struct). The caller
   * threads `loopState` through the remaining loop body and mutates
   * its fields in-place exactly as before (`loopState.iteration++`,
   * `loopState.contentParts.length = 0`, etc.).
   */
  /**
   * BR14b Lot 21b — consume one mesh stream iteration into the
   * `AssistantRunLoopState`. Verbatim port of `chat-service.ts` lines
   * 3203-3384 pre-Lot 21b: drives `deps.mesh.invokeStream`, persists
   * each event via `deps.streamBuffer.append` at sequences allocated
   * by `deps.streamSequencer.allocate`, accumulates deltas into
   * `loopState`, captures `previousResponseId` from `status`, polls
   * pending steer messages, and surfaces a terminal
   * `ConsumeAssistantStreamDoneReason`. See
   * `ConsumeAssistantStreamInput`/`Result` for the contract details.
   */
  async consumeAssistantStream(
    input: ConsumeAssistantStreamInput,
  ): Promise<ConsumeAssistantStreamResult> {
    const { streamId, loopState, request } = input;
    let steerInterruptionRequested = false;
    let steerInterruptionBatch: string[] = [];
    let shouldRetryWithoutPreviousResponse = false;
    let captured: string | undefined;
    try {
      for await (const event of this.deps.mesh.invokeStream({
        providerId: request.providerId,
        model: request.model,
        credential: request.credential,
        userId: request.userId,
        workspaceId: request.workspaceId,
        messages: request.messages,
        tools: request.tools,
        reasoningSummary: request.reasoningSummary,
        reasoningEffort: request.reasoningEffort,
        toolChoice: request.toolChoice,
        previousResponseId: request.previousResponseId ?? undefined,
        rawInput: request.rawInput ?? undefined,
        signal: request.signal,
      })) {
        const eventType = event.type;
        const data = (event.data ?? {}) as Record<string, unknown>;
        // IMPORTANT: do not emit 'done' here — the caller emits a single
        // terminal `done` after pass2/finalization.
        if (eventType === 'done') {
          continue;
        }
        if (eventType === 'error') {
          const msg = (data as Record<string, unknown>).message;
          const errorMessage =
            typeof msg === 'string' ? msg : 'Unknown error';
          if (
            steerInterruptionRequested &&
            errorMessage.toLowerCase().includes('aborted')
          ) {
            continue;
          }
          loopState.lastErrorMessage = errorMessage;
          captured = errorMessage;
          const errSeq = await this.deps.streamSequencer.allocate(streamId);
          await this.deps.streamBuffer.append(
            streamId,
            eventType as StreamEventTypeName,
            data,
            errSeq,
            streamId,
          );
          // let the stream terminate/throw; the global catch will handle it
          continue;
        }

        const seq = await this.deps.streamSequencer.allocate(streamId);
        await this.deps.streamBuffer.append(
          streamId,
          eventType as StreamEventTypeName,
          data,
          seq,
          streamId,
        );

        // Capture Responses API response_id for proper continuation
        if (eventType === 'status') {
          const responseId =
            typeof (data as Record<string, unknown>).response_id === 'string'
              ? ((data as Record<string, unknown>).response_id as string)
              : '';
          if (responseId) loopState.previousResponseId = responseId;
        }

        if (eventType === 'content_delta') {
          const delta = typeof data.delta === 'string' ? data.delta : '';
          if (delta) {
            loopState.contentParts.push(delta);
          }
        } else if (eventType === 'reasoning_delta') {
          const delta = typeof data.delta === 'string' ? data.delta : '';
          if (delta) {
            loopState.reasoningParts.push(delta);
            if (
              loopState.steerReasoningReplay.length <
              STEER_REASONING_REPLAY_MAX_CHARS
            ) {
              loopState.steerReasoningReplay += delta;
              if (
                loopState.steerReasoningReplay.length >
                STEER_REASONING_REPLAY_MAX_CHARS
              ) {
                loopState.steerReasoningReplay =
                  loopState.steerReasoningReplay.slice(
                    -STEER_REASONING_REPLAY_MAX_CHARS,
                  );
              }
            } else {
              loopState.steerReasoningReplay =
                `${loopState.steerReasoningReplay}${delta}`.slice(
                  -STEER_REASONING_REPLAY_MAX_CHARS,
                );
            }
          }
        } else if (eventType === 'tool_call_start') {
          const toolCallId =
            typeof data.tool_call_id === 'string' ? data.tool_call_id : '';
          const existingIndex = loopState.toolCalls.findIndex(
            (tc) => tc.id === toolCallId,
          );
          if (existingIndex === -1) {
            loopState.toolCalls.push({
              id: toolCallId,
              name: typeof data.name === 'string' ? data.name : '',
              args: typeof data.args === 'string' ? data.args : '',
            });
          } else {
            const nextName = typeof data.name === 'string' ? data.name : '';
            const nextArgs = typeof data.args === 'string' ? data.args : '';
            loopState.toolCalls[existingIndex].name =
              nextName || loopState.toolCalls[existingIndex].name;
            loopState.toolCalls[existingIndex].args =
              (loopState.toolCalls[existingIndex].args || '') +
              (nextArgs || '');
          }
        } else if (eventType === 'tool_call_delta') {
          const toolCallId =
            typeof data.tool_call_id === 'string' ? data.tool_call_id : '';
          const delta = typeof data.delta === 'string' ? data.delta : '';
          const toolCall = loopState.toolCalls.find(
            (tc) => tc.id === toolCallId,
          );
          if (toolCall) {
            toolCall.args += delta;
          } else {
            loopState.toolCalls.push({
              id: toolCallId,
              name: '',
              args: delta,
            });
          }
        }
        if (!steerInterruptionRequested) {
          const steerPoll = await consumePendingSteerMessages({
            streamBuffer: this.deps.streamBuffer,
            streamId,
            sinceSequence: loopState.lastObservedStreamSequence,
          });
          loopState.lastObservedStreamSequence = steerPoll.nextSinceSequence;
          const pendingSteerMessages = steerPoll.messages;
          if (pendingSteerMessages.length > 0) {
            steerInterruptionRequested = true;
            steerInterruptionBatch = [...pendingSteerMessages];
            const interruptSeq = await this.deps.streamSequencer.allocate(
              streamId,
            );
            await this.deps.streamBuffer.append(
              streamId,
              'status',
              {
                state: 'run_interrupted_for_steer',
                steer_count: steerInterruptionBatch.length,
                latest_message:
                  steerInterruptionBatch[steerInterruptionBatch.length - 1] ??
                  '',
              },
              interruptSeq,
              streamId,
            );
            break;
          }
        }
        // Note: 'done' is intentionally delayed (see above)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? '');
      if (
        loopState.previousResponseId &&
        isPreviousResponseNotFoundError(message)
      ) {
        shouldRetryWithoutPreviousResponse = true;
      } else {
        throw error;
      }
    }
    if (shouldRetryWithoutPreviousResponse) {
      const resetSeq = await this.deps.streamSequencer.allocate(streamId);
      await this.deps.streamBuffer.append(
        streamId,
        'status',
        {
          state: 'response_lineage_reset',
          reason: 'previous_response_not_found',
        },
        resetSeq,
        streamId,
      );
      loopState.previousResponseId = null;
      loopState.pendingResponsesRawInput = null;
      return {
        doneReason: 'retry_without_previous_response',
        steerInterruptionBatch: [],
      };
    }
    if (steerInterruptionRequested && steerInterruptionBatch.length > 0) {
      loopState.pendingResponsesRawInput = null;
      loopState.previousResponseId = null;
      loopState.steerHistoryMessages.push(...steerInterruptionBatch);
      loopState.currentMessages = [
        ...loopState.currentMessages,
        ...steerInterruptionBatch.map((message) => ({
          role: 'user' as const,
          content: message,
        })),
      ];
      const resumeSeq = await this.deps.streamSequencer.allocate(streamId);
      await this.deps.streamBuffer.append(
        streamId,
        'status',
        {
          state: 'run_resumed_with_steer',
          steer_count: steerInterruptionBatch.length,
          latest_message:
            steerInterruptionBatch[steerInterruptionBatch.length - 1] ?? '',
        },
        resumeSeq,
        streamId,
      );
      return {
        doneReason: 'steer_interrupted',
        steerInterruptionBatch,
      };
    }
    if (captured !== undefined) {
      return {
        doneReason: 'error',
        steerInterruptionBatch: [],
        errorMessage: captured,
      };
    }
    return {
      doneReason: 'normal',
      steerInterruptionBatch: [],
    };
  }

  async beginAssistantRunLoop(
    input: BeginAssistantRunLoopInput,
  ): Promise<AssistantRunLoopState> {
    const streamSeq = await this.deps.streamBuffer.getNextSequence(
      input.assistantMessageId,
    );
    const lastObservedStreamSequence = Math.max(streamSeq - 1, 0);
    const currentMessages: AssistantRunLoopMessage[] = [
      { role: 'system', content: input.systemPrompt },
      ...input.conversation.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];
    const previousResponseId: string | null =
      input.resumeFrom?.previousResponseId ?? null;
    const pendingResponsesRawInput: unknown[] | null = Array.isArray(
      input.resumeFrom?.toolOutputs,
    )
      ? input.resumeFrom!.toolOutputs.map((item) => ({
          type: 'function_call_output',
          call_id: item.callId,
          output: item.output,
        }))
      : null;
    const todoAutonomousExtensionEnabled = Boolean(
      input.enforceTodoUpdateMode && input.todoProgressionFocusMode,
    );
    const todoContinuationActive = Boolean(
      todoAutonomousExtensionEnabled && input.hasActiveSessionTodo,
    );
    return {
      streamSeq,
      lastObservedStreamSequence,
      contentParts: [],
      reasoningParts: [],
      lastErrorMessage: null,
      executedTools: [],
      toolCalls: [],
      currentMessages,
      maxIterations: input.baseMaxIterations,
      todoAutonomousExtensionEnabled,
      todoContinuationActive,
      todoAwaitingUserInput: false,
      iteration: 0,
      previousResponseId,
      pendingResponsesRawInput,
      steerHistoryMessages: [],
      steerReasoningReplay: '',
      lastBudgetAnnouncedPct: -1,
      contextBudgetReplanAttempts: 0,
      continueGenerationLoop: true,
      useCodexTransport: input.useCodexTransport ?? false,
    };
  }

  /**
   * BR14b Lot 21d-3 — public facade over the `executeServerTool` Option A
   * callback (defined on `ChatRuntimeDeps`). Forwards the per-tool input
   * verbatim to `deps.executeServerTool(input)` and returns the callback's
   * `ExecuteServerToolResult` unchanged.
   *
   * The boundary contract is intentionally narrow: chat-core stays
   * agnostic of which api-side helpers, captured locals, or closures the
   * adapter binds inside the callback. Callers that need to dispatch a
   * non-local tool from inside `runAssistantGeneration` (or from
   * `consumeToolCalls` once Lot 21e wires the for-loop) invoke this
   * method instead of taking the deps reference directly — keeping
   * `deps` private to the runtime and the inversion-of-control story
   * intact.
   *
   * Throws when `deps.executeServerTool` is undefined (callback not
   * wired). Test fixtures opt in by supplying a stubbed callback in
   * `ChatRuntimeDeps`; production wiring binds
   * `(input) => this.executeServerToolInternal(input)` in the
   * `ChatService` constructor.
   */
  async executeServerTool(
    input: ExecuteServerToolInput,
  ): Promise<ExecuteServerToolResult> {
    if (!this.deps.executeServerTool) {
      throw new Error(
        'ChatRuntime.executeServerTool: deps.executeServerTool is not wired',
      );
    }
    return this.deps.executeServerTool(input);
  }

  /**
   * BR14b Lot 21c — minimal `consumeToolCalls` orchestration shell.
   *
   * Lot 21c handles only:
   *   1. Empty-toolCalls short-circuit (mirrors chat-service.ts line
   *      3267: `if (toolCalls.length === 0) { continueGenerationLoop =
   *      false; break; }`). Sets `loopState.continueGenerationLoop =
   *      false`, returns `shouldBreakLoop: true`.
   *   2. For-loop with `signal?.aborted` check (throws `AbortError`
   *      verbatim like the inline body at line 3365).
   *   3. Local-tool short-circuit (lines 3367-3387): pushes into
   *      `pendingLocalToolCalls`, emits one `tool_call_result` event
   *      with `{status:'awaiting_external_result'}` via
   *      `deps.streamSequencer.allocate` + `deps.streamBuffer.append`,
   *      and advances `loopState.streamSeq`.
   *
   * Non-local tool calls are NOT dispatched yet — Lot 21d will wire
   * the `executeServerTool` callback + per-tool body (context budget
   * gate + try/catch + result event + accumulators). Until then this
   * method is NOT invoked by chat-service.ts (the inline loop body
   * stays load-bearing) — Lot 21c is a foundation commit that lands
   * the shell so Lot 21d can extend it without scaffolding churn.
   *
   * Note: `loopState.pendingResponsesRawInput = null` (chat-service.ts
   * line 3264) lives BEFORE the empty-toolCalls check in the inline
   * body — outside this method's responsibility — and stays caller-side
   * until Lot 21d.
   */
  async consumeToolCalls(
    input: ConsumeToolCallsInput,
  ): Promise<ConsumeToolCallsResult> {
    const { streamId, loopState, localToolNames, signal } = input;
    if (loopState.toolCalls.length === 0) {
      loopState.continueGenerationLoop = false;
      return {
        toolResults: [],
        responseToolOutputs: [],
        pendingLocalToolCalls: [],
        executedTools: [],
        shouldBreakLoop: true,
      };
    }
    const pendingLocalToolCalls: Array<{
      id: string;
      name: string;
      args: unknown;
    }> = [];
    for (const toolCall of loopState.toolCalls) {
      if (signal?.aborted) throw new Error('AbortError');
      const toolName = String(toolCall.name || '').trim();
      if (toolName && localToolNames.has(toolName)) {
        pendingLocalToolCalls.push({
          id: toolCall.id,
          name: toolName,
          args: parseToolCallArgsForRuntime(toolCall.args),
        });
        const seq = await this.deps.streamSequencer.allocate(streamId);
        await this.deps.streamBuffer.append(
          streamId,
          'tool_call_result',
          {
            tool_call_id: toolCall.id,
            result: { status: 'awaiting_external_result' },
          },
          seq,
          streamId,
        );
        loopState.streamSeq = seq + 1;
        continue;
      }
      // Lot 21d: dispatch `deps.executeServerTool` here for non-local
      // tool calls + accumulate `toolResults` / `responseToolOutputs` /
      // `executedTools`. Until then this branch is a no-op.
    }
    return {
      toolResults: [],
      responseToolOutputs: [],
      pendingLocalToolCalls,
      executedTools: [],
      shouldBreakLoop: false,
    };
  }
}

/**
 * BR14b Lot 21c — verbatim duplicate of `parseToolCallArgs` from
 * `chat-service.ts` line 265. Module-scope so the local-tool
 * short-circuit can parse `tool_call.args` without taking the helper
 * as a dep (same convention as `STEER_REASONING_REPLAY_MAX_CHARS` /
 * `asRecord` from Lot 21b).
 */
const parseToolCallArgsForRuntime = (value: unknown): unknown => {
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
