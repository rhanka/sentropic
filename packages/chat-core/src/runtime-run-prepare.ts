/**
 * BR14b Lot 22b-4 — Fourth step of the `ChatRuntime` god-class split.
 *
 * `ChatRuntimeRunPrepare` owns the nine run-preparation methods migrated
 * into `ChatRuntime` between BR14b Lot 15 and Lot 22a-1 that drive the
 * pre-tool-loop setup of `runAssistantGeneration`:
 *
 *   - Lot 15 `prepareAssistantRun` (precheck slice: session lookup,
 *     workspace resolution, contexts normalisation, conversation
 *     projection).
 *   - Lot 16a `ensureSessionTitle` (title-generation side effect).
 *   - Lot 16b `prepareSystemPrompt` (system prompt build chain via
 *     the `deps.buildSystemPrompt` callback).
 *   - Lot 17 `resolveModelSelection` (public wrapper over the
 *     `deps.resolveModelSelection` callback).
 *   - Lot 18 + Lot 20 `evaluateReasoningEffort` (reasoning-effort
 *     evaluator wrapper that also emits the two bracketing
 *     `reasoning_effort_eval_failed` / `reasoning_effort_selected`
 *     status events when the model supports reasoning).
 *   - Lot 20 `allocateStreamSequence` / `peekStreamSequence` (slim
 *     wrappers over the `StreamSequencer` port).
 *   - Lot 22a-1 `initToolLoopState` (pre-loop init slice: resolve
 *     model + derive codex transport + mutate loopState + evaluate
 *     reasoning + re-sync streamSeq).
 *   - Lot 21a `beginAssistantRunLoop` (tool-loop-local state
 *     initialization mirroring the 40-line inline loop-setup block).
 *
 * The bodies are a VERBATIM move from `runtime.ts`; only the
 * surrounding class changes.
 *
 * Pattern: reuses the Lot 22b-1 / 22b-2 / 22b-3 façade shape exactly.
 * Each sub-class receives the same `ChatRuntimeDeps` by reference (no
 * copy, no state duplication). The `ChatRuntime` façade instantiates
 * one of these per `ChatRuntime` and delegates the public run-prepare
 * methods through one-line wrappers. All public method signatures on
 * `ChatRuntime` stay byte-for-byte identical so that `chat-service.ts`
 * call sites and the 57 unit cases spread across
 * `tests/runtime-precheck.test.ts`, `tests/runtime-system-prompt.test.ts`,
 * `tests/runtime-reasoning-effort.test.ts`,
 * `tests/runtime-init-tool-loop-state.test.ts`, and
 * `tests/runtime-loop-state.test.ts` continue to work unchanged.
 *
 * Per Lot 22b-0 Section D inventory + Lot 22b-4 Step 0 re-scan — zero
 * cross-sub-class `this.<method>` calls. The 9 methods only touch
 * `this.deps.*` and three in-class internal calls (`initToolLoopState`
 * → `resolveModelSelection` + `evaluateReasoningEffort` +
 * `peekStreamSequence`), all of which live inside the SAME sub-class.
 * No sibling-injection needed: the constructor takes `deps` only,
 * mirroring `ChatRuntimeCheckpoint` (Lot 22b-1) and `ChatRuntimeMessages`
 * (Lot 22b-3) rather than `ChatRuntimeSession` (Lot 22b-2, which needed
 * the sibling `checkpoint` reference).
 */
import type {
  AssistantRunContext,
  AssistantRunLoopMessage,
  AssistantRunLoopState,
  BeginAssistantRunLoopInput,
  BuildSystemPromptResult,
  ChatRuntimeDeps,
  EnsureSessionTitleOptions,
  EvaluateReasoningEffortInput,
  InitToolLoopStateInput,
  InitToolLoopStateResult,
  PrepareAssistantRunOptions,
  PrepareSystemPromptOptions,
  ReasoningEffortEvaluation,
} from './runtime.js';

export class ChatRuntimeRunPrepare {
  constructor(private readonly deps: ChatRuntimeDeps) {}

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
   * BR14b Lot 22a-1 — pre-loop initialization slice migrated from
   * `chat-service.ts` lines 3084-3157 pre-Lot 22a-1. Bundles into a
   * single method the four steps the chat-service caller used to drive
   * inline BETWEEN `beginAssistantRunLoop` and the
   * `while (continueGenerationLoop)` body:
   *
   *   1. `resolveModelSelection({userId, providerId, model || assistantRowModel})`
   *      — same delegate call the inline code performed (Lot 12/17
   *      callback).
   *   2. Derive `useCodexTransport = selectedProviderId === 'openai'
   *      && selectedModel === 'gpt-5.5' && (await
   *      resolveOpenAITransportMode()) === 'codex'`. Mirrors the
   *      inline boolean expression verbatim.
   *   3. Mutate `loopState.useCodexTransport = useCodexTransport`
   *      (verbatim assignment from chat-service.ts line 3109 pre-Lot
   *      22a-1). The runtime owns this mutation so the caller no
   *      longer needs to reach into `loopState` for this single field.
   *   4. `evaluateReasoningEffort({...})` with the resolved provider +
   *      model pair (Lot 18/20 callback). The runtime then re-syncs
   *      `streamSeq` via `peekStreamSequence + 1` because
   *      `evaluateReasoningEffort` may have appended 0/1/2 status events
   *      internally.
   *
   * Behavior preservation is the absolute contract: every input + every
   * intermediate cast + every mutation order matches the inline block
   * pre-Lot 22a-1. The legacy `console.error('[chat]
   * reasoning_effort_eval_failed', {assistantMessageId, sessionId,
   * model, evaluatorModel, error})` trace is NOT emitted by this method
   * — it carries `sessionId` (a chat-service-only field) and would also
   * require coupling chat-core to console logging. The caller emits
   * that trace using the returned `reasoning` value (same trace shape,
   * same field set).
   *
   * When `deps.resolveOpenAITransportMode` is undefined (test harness,
   * minimal runtime), the wrapper short-circuits the transport check
   * to `useCodexTransport = false` regardless of the resolved
   * provider/model pair. This mirrors the chat-service-side fallback
   * behavior for any non-openai-gpt-5.5 selection (the boolean is
   * always `false` for those because the leftmost `&&` clauses fail).
   */
  async initToolLoopState(
    input: InitToolLoopStateInput,
  ): Promise<InitToolLoopStateResult> {
    // Step 1 — resolveModelSelection delegate (Lot 12/17 callback).
    const resolvedSelection = await this.resolveModelSelection({
      userId: input.userId,
      providerId: input.providerId ?? undefined,
      model: input.model || input.assistantRowModel,
    });
    const selectedProviderId = resolvedSelection.provider_id;
    const selectedModel = resolvedSelection.model_id;
    // Step 2 — derive useCodexTransport (mirrors the inline boolean
    // expression at chat-service.ts line 3096-3099 pre-Lot 22a-1).
    const useCodexTransport =
      selectedProviderId === 'openai' &&
      selectedModel === 'gpt-5.5' &&
      this.deps.resolveOpenAITransportMode !== undefined &&
      (await this.deps.resolveOpenAITransportMode()) === 'codex';
    // Step 3 — mirror onto loopState (verbatim assignment from line
    // 3109 pre-Lot 22a-1). The mutable in-place write preserves the
    // legacy ordering: the loop body reads `loopState.useCodexTransport`
    // AFTER this assignment, never before.
    input.loopState.useCodexTransport = useCodexTransport;
    // Step 4 — evaluateReasoningEffort (Lot 18/20 callback). The
    // runtime appends 0/1/2 status events internally based on
    // shouldEvaluate + failure.
    const reasoning = await this.evaluateReasoningEffort({
      userId: input.userId,
      workspaceId: input.sessionWorkspaceId,
      selectedProviderId,
      selectedModel,
      conversation: input.conversation,
      signal: input.signal,
      streamId: input.assistantMessageId,
    });
    // Re-sync the streamSeq cursor with the runtime after
    // `evaluateReasoningEffort` appended 0 (callback unwired /
    // non-reasoning model), 1 (success path), or 2 (failure path)
    // status events internally. `peek` returns the latest allocated
    // sequence; the next caller-side `writeStreamEvent` continues
    // from `peek + 1`.
    const streamSeq =
      (await this.peekStreamSequence(input.assistantMessageId)) + 1;
    return {
      selectedProviderId,
      selectedModel,
      useCodexTransport,
      reasoning,
      reasoningEffortForThisMessage: reasoning.effortForMessage,
      streamSeq,
    };
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
}
