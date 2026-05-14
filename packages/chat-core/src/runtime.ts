/**
 * BR14b Lot 9/10/11 — chat orchestration extraction.
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
 *   Lot 11  (THIS LOT)    — Refactor `postgresChatCheckpointAdapter` to
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
 *   Lots 12+ (NEXT)       — Move continuation generation, tool loop,
 *                            reasoning loop, cancel, retry, and finally
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
import type { ChatMessageRow, MessageStore } from './message-port.js';
import type { SessionStore } from './session-port.js';
import type { StreamBuffer, StreamEventTypeName } from './stream-port.js';
import type { MeshDispatchPort } from './mesh-port.js';

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
  readonly checkpointStore: CheckpointStore<ChatState>;
  readonly mesh: MeshDispatchPort;
  readonly normalizeVsCodeCodeAgent: (
    input: unknown,
  ) => NormalizedVsCodeCodeAgentRuntimePayload | null;
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
}

// Suppress the lint warning for the unused parseChatCheckpointKey
// helper: it is exported as a runtime utility for future debugging /
// migration tooling. Keeping it next to `encodeChatCheckpointKey`
// ensures the key shape stays symmetric in one file.
void parseChatCheckpointKey;
