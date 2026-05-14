/**
 * BR14b Lot 9 — first orchestration extraction.
 *
 * `ChatRuntime` is the future home of all chat orchestration that lives
 * above the persistence/stream ports already extracted in Lots 4/6/7/8:
 *
 *   Lots 4/6/7/8 (DONE)   — CheckpointStore + MessageStore + StreamBuffer
 *                            + SessionStore ports + Postgres adapters.
 *                            `chat-service.ts` delegates each persistence
 *                            call to its adapter.
 *
 *   Lot 9   (THIS LOT)    — Establish the `ChatRuntime` shell with DI of
 *                            the four existing ports + mesh hook. Migrate
 *                            ONE smallest atomic orchestration slice
 *                            (`finalizeAssistantMessageFromStream`) into
 *                            the runtime. Set the pattern for the next
 *                            lots: orchestration methods (vs persistence
 *                            methods already on the adapters) move INTO
 *                            this class while `chat-service.ts` becomes a
 *                            thin facade.
 *
 *   Lots 10+ (NEXT)       — Move tool loop, reasoning loop, continuation
 *                            (`acceptLocalToolResult`), cancel, retry
 *                            (`retryUserMessage`), and finally
 *                            `runAssistantGeneration` itself into the
 *                            runtime. Persistence stays on the ports.
 *
 * Per SPEC §1 / §5 / §14 — chat-core owns single-session orchestration.
 * Mesh access stays delegated through a callable `invokeModel` hook so
 * chat-core has zero compile-time dependency on `@sentropic/llm-mesh`.
 *
 * Behavior preservation is the absolute contract: the migrated method is
 * a verbatim move (line-for-line) of the body that lived in
 * `chat-service.ts`. The only changes are: (a) `this.deps.*` instead of
 * the module-level adapter singletons, (b) the StreamBuffer call shape
 * that already existed via `stream-service.ts` is preserved by depending
 * on the port methods (`getNextSequence`, `append`, `read`) directly.
 */
import type { ChatState } from './types.js';
import type { CheckpointStore } from './checkpoint-port.js';
import type { MessageStore } from './message-port.js';
import type { SessionStore } from './session-port.js';
import type { StreamBuffer, StreamEventTypeName } from './stream-port.js';

/**
 * DI container for `ChatRuntime`.
 *
 * Four persistence ports already exist in the worktree and are wired in
 * `chat-service.ts` via module-level adapter singletons. The runtime
 * accepts them as constructor dependencies so a future test harness can
 * inject in-memory fakes (SPEC §5: every port ships an `in-memory`
 * reference adapter).
 *
 * `invokeModel` is a forward-looking hook reserved for the upcoming
 * mesh boundary port. Lot 9 does NOT exercise it (the migrated slice
 * does not call the model). It is declared here so subsequent lots
 * (tool loop, reasoning loop, continuation) can wire mesh dispatch
 * without changing this signature. Kept untyped (`unknown`) on purpose
 * — the precise mesh port is designed in Lot 10+.
 */
export type ChatRuntimeDeps = {
  readonly messageStore: MessageStore;
  readonly sessionStore: SessionStore;
  readonly streamBuffer: StreamBuffer;
  readonly checkpointStore: CheckpointStore<ChatState>;
  readonly invokeModel?: (input: unknown) => Promise<unknown>;
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
}
