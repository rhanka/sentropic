/**
 * BR14b Lot 21a — pure context-budget helpers.
 *
 * Extracted verbatim from `api/src/services/chat-service.ts`
 * (`runAssistantGeneration`). Pre-Lot 21a the closure
 * `writeContextBudgetStatus` (chat-service.ts line 3009-3037) captured
 * three mutable locals — `streamSeq`, `lastBudgetAnnouncedPct`, and
 * `options.assistantMessageId` — and emitted a single
 * `status:context_budget_update` stream event whenever the occupancy
 * percentage moved or the zone left the `normal` band. Lot 21a turns
 * the closure into a pure function that takes the captured cursors as
 * explicit inputs and returns the updated cursors as result fields:
 *
 *   - `lastBudgetAnnouncedPct` (in: previous announced pct, out: new
 *     announced pct) — the caller assigns the returned value back to
 *     its local counter so the next call short-circuits on identical
 *     occupancy + normal zone (verbatim pre-Lot 21a behaviour).
 *
 *   - The shared `streamSeq` cursor is now driven by the
 *     `StreamSequencer` port (Lot 20). The helper allocates a sequence
 *     via `streamSequencer.allocate(streamId)` and appends via
 *     `streamBuffer.append(...)`. The caller no longer mutates
 *     `streamSeq` around the helper; it re-syncs from
 *     `streamSequencer.peek(streamId) + 1` after the call — same
 *     pattern Lot 20 introduced around `evaluateReasoningEffort`.
 *
 * Behaviour preservation is the absolute contract — same short-circuit
 * (`snapshot.occupancyPct === lastBudgetAnnouncedPct && zone === 'normal'`
 * skips the append), same event payload shape, same allocation
 * semantics. Mirrors the Lot 19 `steer.ts` + Lot 14b `history.ts`
 * pure-helper extraction pattern so any future CLI/runtime consumer
 * can wire its own `StreamBuffer` + `StreamSequencer` adapters.
 *
 * `ContextBudgetZone` + `ContextBudgetSnapshot` move to this module
 * because they are the helper's input contract and downstream consumers
 * (the tool-loop slice migrating in Lot 21b) will read them as the
 * runtime boundary type.
 */
import type { StreamBuffer } from './stream-port.js';
import type { StreamSequencer } from './stream-sequencer-port.js';

/**
 * Context-budget occupancy zone. Mirrors the union previously declared
 * in `chat-service.ts` (`type ContextBudgetZone = 'normal' | 'soft' |
 * 'hard'`). Resolution policy stays caller-side (`resolveBudgetZone`
 * lives in `chat-service.ts`) because it depends on the api-side
 * threshold constants; chat-core only consumes the resolved label.
 */
export type ContextBudgetZone = 'normal' | 'soft' | 'hard';

/**
 * Verbatim copy of `chat-service.ts` `type ContextBudgetSnapshot` (line
 * 315-320 pre-Lot 21a). The four fields are the snapshot consumed by
 * the runtime budget evaluator and projected through the
 * `status:context_budget_update` stream event.
 */
export type ContextBudgetSnapshot = {
  readonly estimatedTokens: number;
  readonly maxTokens: number;
  readonly occupancyPct: number;
  readonly zone: ContextBudgetZone;
};

/**
 * Phase tag carried in the `status:context_budget_update` event payload.
 * Mirrors the `phase` parameter of the chat-service closure pre-Lot 21a.
 * `pre_model` brackets reasoning passes; `pre_tool` brackets tool
 * dispatches.
 */
export type ContextBudgetPhase = 'pre_model' | 'pre_tool';

/**
 * Input contract for `writeContextBudgetStatus`. Pre-Lot 21a these
 * fields lived as closure captures in `runAssistantGeneration`. The
 * pure helper surfaces them as explicit fields.
 *
 *   - `streamBuffer` / `streamSequencer` — append + allocation ports
 *     (the postgres adapters in chat-service, the in-memory adapters
 *     in chat-core tests).
 *   - `streamId` — chat-service uses `options.assistantMessageId` as
 *     both the stream id and the message id.
 *   - `phase` / `snapshot` / `extras` — the public arguments the
 *     closure exposed.
 *   - `lastBudgetAnnouncedPct` — the captured cursor pre-Lot 21a;
 *     drives the short-circuit and is returned advanced when the
 *     helper appended an event.
 */
export type WriteContextBudgetStatusInput = {
  readonly streamBuffer: StreamBuffer;
  readonly streamSequencer: StreamSequencer;
  readonly streamId: string;
  readonly phase: ContextBudgetPhase;
  readonly snapshot: ContextBudgetSnapshot;
  readonly lastBudgetAnnouncedPct: number;
  readonly extras?: Record<string, unknown>;
};

/**
 * Pure result of `writeContextBudgetStatus`. `appended` is `true` when
 * the helper actually emitted a stream event (i.e. the short-circuit
 * did not fire), `false` when the snapshot was the same occupancy +
 * still in the `normal` zone. `lastBudgetAnnouncedPct` is the cursor
 * the caller should assign back: advanced to `snapshot.occupancyPct`
 * when `appended === true`, unchanged otherwise.
 */
export type WriteContextBudgetStatusResult = {
  readonly appended: boolean;
  readonly lastBudgetAnnouncedPct: number;
};

/**
 * Emit a `status:context_budget_update` stream event when the budget
 * snapshot crosses the short-circuit guard. Verbatim port of the
 * `writeContextBudgetStatus` closure at `chat-service.ts` line
 * 3009-3037 (pre-Lot 21a). The closure body was:
 *
 *   if (snapshot.occupancyPct === lastBudgetAnnouncedPct &&
 *       snapshot.zone === 'normal') return;
 *   await writeStreamEvent(streamId, 'status', {
 *     state: 'context_budget_update', phase, occupancy_pct, ...
 *   }, streamSeq, streamId);
 *   streamSeq += 1;
 *   lastBudgetAnnouncedPct = snapshot.occupancyPct;
 *
 * Lot 21a turns the closure mutations into return values: the caller
 * assigns `result.lastBudgetAnnouncedPct` back to its local counter
 * and re-syncs `streamSeq` from `streamSequencer.peek(streamId) + 1`
 * after the call.
 */
export const writeContextBudgetStatus = async (
  input: WriteContextBudgetStatusInput,
): Promise<WriteContextBudgetStatusResult> => {
  const { snapshot, lastBudgetAnnouncedPct } = input;
  if (
    snapshot.occupancyPct === lastBudgetAnnouncedPct &&
    snapshot.zone === 'normal'
  ) {
    return { appended: false, lastBudgetAnnouncedPct };
  }
  const sequence = await input.streamSequencer.allocate(input.streamId);
  await input.streamBuffer.append(
    input.streamId,
    'status',
    {
      state: 'context_budget_update',
      phase: input.phase,
      occupancy_pct: snapshot.occupancyPct,
      estimated_tokens: snapshot.estimatedTokens,
      max_tokens: snapshot.maxTokens,
      zone: snapshot.zone,
      ...(input.extras ?? {}),
    },
    sequence,
    input.streamId,
  );
  return {
    appended: true,
    lastBudgetAnnouncedPct: snapshot.occupancyPct,
  };
};
