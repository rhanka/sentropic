/**
 * BR14b Lot 22b-5 — Fifth step of the `ChatRuntime` god-class split.
 *
 * `ChatRuntimeToolDispatch` owns the four tool-loop methods migrated
 * into `ChatRuntime` between BR14b Lot 21b and Lot 21e-2 that drive the
 * per-iteration assistant stream consumption, server-tool dispatch,
 * per-tool budget gating, and the full `for (const toolCall of ...)`
 * loop body of `runAssistantGeneration`:
 *
 *   - Lot 21b `consumeAssistantStream` (mesh stream consumption +
 *     per-event buffer persistence + steer interruption polling +
 *     `previous_response_id` lineage capture + retry-without-prev
 *     recovery path).
 *   - Lot 21d-3 `executeServerTool` (thin facade over the
 *     `deps.executeServerTool` Option A callback that keeps the
 *     api-side per-tool dispatch closure out of chat-core).
 *   - Lot 21c / 21e-2 `consumeToolCalls` (full per-iteration
 *     tool-dispatch loop: empty-toolCalls short-circuit, local-tool
 *     branch, per-tool budget gate, dispatch via `executeServerTool`,
 *     success/error accumulators, todo `plan` handling).
 *   - Lot 21e-1 `applyContextBudgetGate` (per-tool context budget
 *     gate emitting deferred `tool_call_result` events on the
 *     soft/hard zones plus the optional `context_budget_user_escalation_required`
 *     status when `contextBudgetReplanAttempts > maxReplanAttempts`).
 *
 * The bodies are a VERBATIM move from `runtime.ts`; only the
 * surrounding class changes.
 *
 * Pattern: reuses the Lot 22b-1 / 22b-2 / 22b-3 / 22b-4 façade shape
 * exactly. Each sub-class receives the same `ChatRuntimeDeps` by
 * reference (no copy, no state duplication). The `ChatRuntime` façade
 * instantiates one of these per `ChatRuntime` and delegates the public
 * tool-dispatch methods through one-line wrappers. All public method
 * signatures on `ChatRuntime` stay byte-for-byte identical so that
 * `chat-service.ts` call sites and the unit cases spread across
 * `tests/runtime-consume-assistant-stream.test.ts`,
 * `tests/runtime-execute-server-tool.test.ts`,
 * `tests/runtime-consume-tool-calls.test.ts`, and
 * `tests/runtime-apply-context-budget-gate.test.ts` continue to work
 * unchanged.
 *
 * Per Lot 22b-0 Section D inventory + Lot 22b-5 Step 0 re-scan — zero
 * cross-sub-class `this.<method>` calls. The 4 methods only touch
 * `this.deps.*` and two in-class internal calls (`consumeToolCalls` →
 * `applyContextBudgetGate` + `executeServerTool`), both of which live
 * inside the SAME sub-class. No sibling-injection needed: the
 * constructor takes `deps` only, mirroring `ChatRuntimeCheckpoint`
 * (Lot 22b-1), `ChatRuntimeMessages` (Lot 22b-3), and
 * `ChatRuntimeRunPrepare` (Lot 22b-4) rather than `ChatRuntimeSession`
 * (Lot 22b-2, which needed the sibling `checkpoint` reference).
 *
 * Lot 22b-5 staging note: Step 1 lands the file scaffold + the
 * `applyContextBudgetGate` body only. Subsequent steps append the
 * remaining three bodies + their imports verbatim (Step 2:
 * `executeServerTool`; Step 3: `consumeAssistantStream`; Step 4:
 * `consumeToolCalls`). The class is NOT yet wired into the `ChatRuntime`
 * façade — Step 5 inserts the field declaration, the constructor
 * instantiation, and the four one-line delegators.
 */
import type { ContextBudgetSnapshot } from './context-budget.js';
import type {
  ApplyContextBudgetGateInput,
  ApplyContextBudgetGateResult,
  ChatRuntimeDeps,
  ExecuteServerToolInput,
  ExecuteServerToolResult,
} from './runtime.js';

export class ChatRuntimeToolDispatch {
  constructor(private readonly deps: ChatRuntimeDeps) {}

  /**
   * BR14b Lot 21e-1 — per-tool context-budget gate.
   *
   * Verbatim port of the inline block at `chat-service.ts` lines
   * 3534-3636 (post-Lot 21d-3): runs the pre-tool budget projection,
   * triggers compaction on the hard zone, and emits a deferred
   * `tool_call_result` (plus an optional escalation status when the
   * replan attempt counter exceeds the api-side
   * `CONTEXT_BUDGET_MAX_REPLAN_ATTEMPTS` constant) when the projected
   * zone is non-normal. Returns `shouldContinue: true` in that case so
   * the caller's for-loop body skips the per-tool dispatch via
   * `runtime.executeServerTool(...)` and pushes the
   * `deferredAccumulator` payload into its three local accumulators
   * (`toolResults` / `responseToolOutputs` / `executedTools`).
   *
   * Pre-Lot 21e-1 the block lived inline inside the for-loop body of
   * `ChatService.runAssistantGeneration`. The migration is verbatim:
   * the projection math, the deferred-result payload shape, the two
   * event payloads, and the `+= 1` / `= 0` semantics of
   * `contextBudgetReplanAttempts` are byte-identical. The caller still
   * owns the three accumulator arrays + the `currentMessages`
   * mutation (the latter happens inside the compaction callback) so
   * the gate stays a thin orchestration slice with no captured locals
   * beyond the explicit input bundle.
   *
   * Event emission goes through `deps.streamSequencer.allocate` +
   * `deps.streamBuffer.append` (same convention as
   * `consumeToolCalls`) rather than through a caller-supplied
   * `writeStreamEvent` callback so the runtime owns sequence
   * advancement. The returned `streamSeq` is the cursor the caller
   * must reassign locally to stay in sync.
   *
   * The pre-tool budget snapshot (`preToolBudget`) and the projected
   * payload chars (`projectedResultChars`) are pre-computed by the
   * caller because `estimateContextBudget` /
   * `estimateToolResultProjectionChars` are api-side helpers
   * (`MODEL_CONTEXT_BUDGETS`, per-tool projection heuristics). Same
   * with `resolveBudgetZone` and `estimateTokenCountFromChars` which
   * cross as inputs to keep the api-side constants out of chat-core.
   * `compactContextIfNeeded` is a caller-side closure because it
   * mutates `currentMessages` (caller-local state) via
   * `compactConversationContext` (api-side helper).
   *
   * NOTE: The caller MUST call `writeContextBudgetStatus('pre_tool',
   * preToolBudget, { tool_name })` BEFORE invoking this method (the
   * inline block does it at line 3547, before any projection). The
   * status event is emitted by the api-side wrapper that re-syncs
   * `lastBudgetAnnouncedPct` — keeping it caller-side preserves the
   * pre-existing announce-once short-circuit semantics from Lot 21a.
   */
  async applyContextBudgetGate(
    input: ApplyContextBudgetGateInput,
  ): Promise<ApplyContextBudgetGateResult> {
    const {
      streamId,
      toolCall,
      args,
      projectedResultChars,
      maxReplanAttempts,
      softZoneCode,
      hardZoneCode,
      resolveBudgetZone,
      estimateTokenCountFromChars,
      compactContextIfNeeded,
    } = input;
    let preToolBudget = input.preToolBudget;
    let streamSeq = input.streamSeq;
    let contextBudgetReplanAttempts = input.contextBudgetReplanAttempts;
    const computeProjected = (snapshot: ContextBudgetSnapshot) => {
      const projectedTokens =
        snapshot.estimatedTokens +
        estimateTokenCountFromChars(projectedResultChars);
      const projectedPct = Math.min(
        100,
        Math.max(0, Math.round((projectedTokens / snapshot.maxTokens) * 100)),
      );
      return {
        projectedTokens,
        projectedPct,
        projectedZone: resolveBudgetZone(projectedPct),
      };
    };
    let projectedBudget = computeProjected(preToolBudget);
    if (projectedBudget.projectedZone === 'hard') {
      preToolBudget = await compactContextIfNeeded(
        'pre_tool_hard_threshold',
        preToolBudget,
      );
      projectedBudget = computeProjected(preToolBudget);
    }
    if (projectedBudget.projectedZone !== 'normal') {
      contextBudgetReplanAttempts += 1;
      const escalationRequired =
        contextBudgetReplanAttempts > maxReplanAttempts;
      const deferredResult = {
        status: 'deferred' as const,
        code:
          projectedBudget.projectedZone === 'hard'
            ? hardZoneCode
            : softZoneCode,
        message:
          projectedBudget.projectedZone === 'hard'
            ? 'Tool call blocked: context budget still above hard threshold after compaction.'
            : 'Tool call deferred: projected output would exceed context budget soft threshold.',
        occupancy_pct: projectedBudget.projectedPct,
        estimated_tokens: projectedBudget.projectedTokens,
        max_tokens: preToolBudget.maxTokens,
        replan_required: true as const,
        escalation_required: escalationRequired,
        suggested_actions: [
          'Narrow scope and retry tool with smaller payload.',
          'Use history_analyze for targeted extraction if needed.',
        ],
      };
      const seq1 = await this.deps.streamSequencer.allocate(streamId);
      await this.deps.streamBuffer.append(
        streamId,
        'tool_call_result',
        { tool_call_id: toolCall.id, result: deferredResult },
        seq1,
        streamId,
      );
      streamSeq = seq1 + 1;
      if (escalationRequired) {
        const seq2 = await this.deps.streamSequencer.allocate(streamId);
        await this.deps.streamBuffer.append(
          streamId,
          'status',
          {
            state: 'context_budget_user_escalation_required',
            occupancy_pct: projectedBudget.projectedPct,
            code: deferredResult.code,
          },
          seq2,
          streamId,
        );
        streamSeq = seq2 + 1;
      }
      return {
        shouldContinue: true,
        streamSeq,
        contextBudgetReplanAttempts,
        preToolBudget,
        deferredAccumulator: {
          deferredResult,
          toolCallId: toolCall.id,
          toolName: toolCall.name || 'unknown_tool',
          args,
        },
      };
    }
    contextBudgetReplanAttempts = 0;
    return {
      shouldContinue: false,
      streamSeq,
      contextBudgetReplanAttempts,
      preToolBudget,
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
}
