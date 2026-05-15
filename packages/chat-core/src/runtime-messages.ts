/**
 * BR14b Lot 22b-3 — Third step of the `ChatRuntime` god-class split.
 *
 * `ChatRuntimeMessages` owns the six public message-lifecycle methods
 * + one private helper that were migrated into `ChatRuntime` in BR14b
 * Lot 9 (`finalizeAssistantMessageFromStream`), Lot 10
 * (`acceptLocalToolResult` + `extractAwaitingLocalToolState`), Lot 12
 * (`retryUserMessage` + `createUserMessageWithAssistantPlaceholder`),
 * and Lot 13 (`setMessageFeedback` + `updateUserMessageContent`). The
 * bodies are a VERBATIM move from `runtime.ts`; only the surrounding
 * class changes.
 *
 * Pattern: reuses the Lot 22b-1 / 22b-2 façade shape exactly. Each
 * sub-class receives the same `ChatRuntimeDeps` by reference (no copy,
 * no state duplication). The `ChatRuntime` façade instantiates one of
 * these per `ChatRuntime` and delegates the public message methods
 * through one-line wrappers. All public method signatures on
 * `ChatRuntime` stay byte-for-byte identical so that `chat-service.ts`
 * call sites and the 9 message-CRUD unit tests
 * (`tests/runtime-message.test.ts`) continue to work unchanged.
 *
 * Per Lot 22b-0 Section D inventory + Lot 22b-3 Step 0 re-scan — zero
 * cross-sub-class `this.<method>` calls. The six public methods only
 * touch `this.deps.*` and the in-class private helper
 * `this.extractAwaitingLocalToolState` (called from
 * `acceptLocalToolResult`, lives in the SAME file). The private helper
 * itself only calls `this.deps.normalizeVsCodeCodeAgent`. No
 * sibling-injection needed: the constructor takes `deps` only, mirroring
 * `ChatRuntimeCheckpoint` (Lot 22b-1) rather than `ChatRuntimeSession`
 * (Lot 22b-2, which needed the sibling `checkpoint` reference).
 */
import { randomUUID } from 'node:crypto';

import type { StreamEventTypeName } from './stream-port.js';
import type {
  AcceptLocalToolResultOptions,
  AcceptLocalToolResultResponse,
  AwaitingLocalToolState,
  ChatRuntimeDeps,
  CreateUserMessageResult,
  FinalizeAssistantOptions,
  FinalizeAssistantResult,
  LocalToolDefinitionInput,
  RetryUserMessageOptions,
  RetryUserMessageResult,
  RuntimeCreateChatMessageInput,
} from './runtime.js';
import {
  asRecord,
  isValidToolName,
  serializeToolOutput,
} from './runtime.js';

export class ChatRuntimeMessages {
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
}
