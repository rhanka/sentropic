/**
 * BR14b Lot 22b-6 — Sixth and FINAL step of the `ChatRuntime` god-class
 * split.
 *
 * `ChatRuntimeFinalization` owns the three post-stream / post-tool-loop
 * finalization methods migrated into `ChatRuntime` between BR14b Lot
 * 21e-3 and Lot 22a-2 that drive the per-iteration finalization, the
 * terminal `done` event emission + persistence, and the pass2 fallback
 * branch invoked when the first pass produced no usable content:
 *
 *   - Lot 21e-3 `finalizeAssistantIteration` (per-iteration executed-tools
 *     trace + todo runtime refresh + `pendingLocalToolCalls`
 *     short-circuit emitting `status:awaiting_local_tool_results` + the
 *     post-iteration history / rawInput rebuild handling the
 *     `needsExplicitToolReplay` branches for Codex / Anthropic / Mistral
 *     / Cohere).
 *   - Lot 21e-3 `emitFinalAssistantTurn` (terminal `done` event + persist
 *     final assistant content + reasoning via
 *     `MessageStore.updateAssistantContent` + touch session `updatedAt`
 *     via `SessionStore.touchUpdatedAt`).
 *   - Lot 22a-2 `runPass2Fallback` (pass2 mesh stream with tools disabled
 *     and `toolChoice='none'` when `contentParts.join('').trim()` is
 *     empty; in-place mutation of the caller's `contentParts` /
 *     `reasoningParts` buffers + `lastErrorMessage` reset; final
 *     `'Second pass produced no content'` throw when the pass2 still
 *     produced nothing).
 *
 * The bodies are a VERBATIM move from `runtime.ts`; only the
 * surrounding class changes.
 *
 * Pattern: reuses the Lot 22b-1 / 22b-2 / 22b-3 / 22b-4 / 22b-5 façade
 * shape exactly. Each sub-class receives the same `ChatRuntimeDeps` by
 * reference (no copy, no state duplication). The `ChatRuntime` façade
 * instantiates one of these per `ChatRuntime` and delegates the public
 * finalization methods through one-line wrappers. All public method
 * signatures on `ChatRuntime` stay byte-for-byte identical so that
 * `chat-service.ts` call sites and the unit cases spread across
 * `tests/runtime-finalize-turn.test.ts` (20 cases) and
 * `tests/runtime-pass2-fallback.test.ts` (12 cases) continue to work
 * unchanged.
 *
 * Per Lot 22b-0 Section D inventory + Lot 22b-6 Step 0 re-scan — zero
 * cross-sub-class `this.<method>` calls. The 3 methods only touch
 * `this.deps.*` and module-scope helpers (`safeTruncateForRuntime`,
 * `safeJsonForRuntime`, `buildToolDigestForRuntime`). No sibling-injection
 * needed: the constructor takes `deps` only, mirroring
 * `ChatRuntimeCheckpoint` (Lot 22b-1), `ChatRuntimeMessages` (Lot
 * 22b-3), `ChatRuntimeRunPrepare` (Lot 22b-4), and
 * `ChatRuntimeToolDispatch` (Lot 22b-5) rather than `ChatRuntimeSession`
 * (Lot 22b-2, which needed the sibling `checkpoint` reference).
 *
 * Lot 22b-6 staging note: Step 1 lands the file scaffold + the
 * `finalizeAssistantIteration` body (the largest of the 3 at ~269 LOC).
 * Subsequent steps append the remaining two bodies + their imports
 * verbatim (Step 2: `emitFinalAssistantTurn`; Step 3: `runPass2Fallback`
 * + the 3 module-scope helpers). The class is NOT yet wired into the
 * `ChatRuntime` façade — Step 4 inserts the field declaration, the
 * constructor instantiation, and the three one-line delegators.
 *
 * At Lot 22b-6 close, `ChatRuntime` is a thin façade (~80 LOC class
 * body) delegating to 6 domain sub-classes. The god class is gone.
 */
import type { StreamEventTypeName } from './stream-port.js';
import type {
  ChatRuntimeDeps,
  EmitFinalAssistantTurnInput,
  EmitFinalAssistantTurnResult,
  FinalizeAssistantIterationInput,
  FinalizeAssistantIterationResult,
  RunPass2FallbackInput,
  RunPass2FallbackResult,
} from './runtime.js';

/**
 * BR14b Lot 22a-2 — verbatim duplicates of `safeTruncate`, `safeJson`,
 * and `buildToolDigest` from `chat-service.ts` (lines ~1125-1154). Tiny
 * pure helpers, duplicated rather than re-imported to keep chat-core
 * free of any api/* module dependency (same convention as
 * `parseToolCallArgsForRuntime` and `asRecord`). Consumed by
 * `ChatRuntimeFinalization.runPass2Fallback` to build the pass2 user
 * message digest from the executed tools ledger.
 *
 * BR14b Lot 22b-6 — moved from `runtime.ts` to `runtime-finalization.ts`
 * together with their sole caller `runPass2Fallback`. The 3 helpers
 * stay module-scope `const` (not exported) because no other sub-class
 * or external module references them.
 */
const safeTruncateForRuntime = (text: string, maxLen: number): string => {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n…(tronqué)…';
};

const safeJsonForRuntime = (value: unknown, maxLen: number): string => {
  try {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    return safeTruncateForRuntime(raw, maxLen);
  } catch {
    return safeTruncateForRuntime(String(value), maxLen);
  }
};

const buildToolDigestForRuntime = (
  executed: ReadonlyArray<{ name: string; result: unknown }>,
): string => {
  if (!executed.length) return '(aucun outil exécuté)';
  // On limite agressivement pour éviter des prompts énormes (ex: web_extract).
  const parts: string[] = [];
  const maxPerTool = 4000;
  const maxTotal = 12000;
  for (const t of executed) {
    const block = `- ${t.name}:\n${safeJsonForRuntime(t.result, maxPerTool)}`;
    parts.push(block);
    if (parts.join('\n\n').length > maxTotal) break;
  }
  return safeTruncateForRuntime(parts.join('\n\n'), maxTotal);
};

export class ChatRuntimeFinalization {
  constructor(private readonly deps: ChatRuntimeDeps) {}

  /**
   * BR14b Lot 21e-3 — post-`consumeToolCalls` per-iteration finalization
   * block.
   *
   * Verbatim port of the inline blocks at `chat-service.ts` lines
   * 3618-3781 (post-Lot 21e-2): the per-iteration executed-tools trace
   * emission (Block A — trace), the todo runtime refresh (Block A —
   * todo refresh), the `pendingLocalToolCalls` short-circuit emitting
   * `status:awaiting_local_tool_results` (Block B), and the
   * post-iteration history/rawInput rebuild handling the
   * `needsExplicitToolReplay` branches for Codex / Anthropic / Mistral /
   * Cohere (Block C).
   *
   * Two api-side closures cross as optional Option A callbacks
   * (`writeChatGenerationTrace` + `refreshSessionTodoRuntime`) — same
   * pattern as Lots 16a/16b/18/21c/21e-1. When the trace callback is
   * undefined the trace is silently skipped (test fixtures don't need
   * `chat-trace.ts` wiring). When the todo refresh callback is
   * undefined or `todoAutonomousExtensionEnabled` is false or
   * `todoAwaitingUserInput` is true (mirrors the inline guard at line
   * 3648), the refresh is skipped and the booleans pass through
   * verbatim.
   *
   * Event emission for Block B goes through `deps.streamSequencer.allocate`
   * + `deps.streamBuffer.append` (same convention as
   * `applyContextBudgetGate` and `consumeToolCalls`). The returned
   * `streamSeq` is the cursor the caller must reassign locally.
   *
   * The pendingLocalToolCalls short-circuit throws the legacy
   * `'Unable to pause generation for local tools: missing previous_response_id'`
   * error when `previousResponseId` is `null` (mirrors the inline throw
   * at lines 3674-3676). The caller propagates the error up the job
   * queue.
   */
  async finalizeAssistantIteration(
    input: FinalizeAssistantIterationInput,
  ): Promise<FinalizeAssistantIterationResult> {
    const {
      streamId,
      traceEnabled,
      sessionId,
      assistantMessageId,
      userId,
      workspaceId,
      iteration,
      modelId,
      toolChoice,
      tools,
      currentMessages: currentMessagesInput,
      previousResponseId: previousResponseIdInput,
      responseToolOutputs,
      toolCalls,
      executedTools,
      writeChatGenerationTrace,
      todoAutonomousExtensionEnabled,
      todoAwaitingUserInput: todoAwaitingUserInputInput,
      refreshSessionTodoRuntime,
      currentUserRole,
      pendingLocalToolCalls,
      localTools,
      vscodeCodeAgentPayload,
      streamSeq: streamSeqInput,
      useCodexTransport,
      providerId,
      contentParts,
    } = input;
    let streamSeq = streamSeqInput;
    let currentMessages: ReadonlyArray<unknown> = currentMessagesInput;
    let previousResponseId: string | null = previousResponseIdInput;
    let todoContinuationActive = true;
    let todoAwaitingUserInput = todoAwaitingUserInputInput;

    // Block A — trace executed tool calls for this iteration (args/results).
    // Verbatim port of chat-service.ts lines 3619-3646.
    if (writeChatGenerationTrace) {
      await writeChatGenerationTrace({
        enabled: traceEnabled,
        sessionId,
        assistantMessageId,
        userId,
        workspaceId,
        phase: 'pass1',
        iteration,
        model: modelId,
        toolChoice,
        tools: tools ?? null,
        openaiMessages: {
          kind: 'executed_tools',
          messages: currentMessages,
          previous_response_id: previousResponseId,
          responses_input_tool_outputs: responseToolOutputs,
        },
        toolCalls: toolCalls.map((tc) => {
          const found = executedTools.find((x) => x.toolCallId === tc.id);
          return {
            id: tc.id,
            name: tc.name,
            args:
              found?.args ??
              (tc.args
                ? (() => {
                    try {
                      return JSON.parse(tc.args);
                    } catch {
                      return tc.args;
                    }
                  })()
                : undefined),
            result: found?.result,
          };
        }),
        meta: {
          kind: 'executed_tools',
          callSite:
            'ChatService.runAssistantGeneration/pass1/afterTools',
          openaiApi: 'responses',
        },
      });
    }

    // Block A — todo refresh.
    // Verbatim port of chat-service.ts lines 3648-3670.
    if (
      todoAutonomousExtensionEnabled &&
      !todoAwaitingUserInput &&
      refreshSessionTodoRuntime
    ) {
      const refreshed = await refreshSessionTodoRuntime({
        sessionId,
        userId,
        workspaceId,
        currentUserRole,
      });
      if (!refreshed.hasRefreshedSessionTodo) {
        todoContinuationActive = false;
      } else {
        todoContinuationActive = refreshed.todoContinuationActive;
        if (refreshed.todoAwaitingUserInputAfterRefresh) {
          todoAwaitingUserInput = true;
        }
      }
    }

    // Block B — pendingLocalToolCalls short-circuit.
    // Verbatim port of chat-service.ts lines 3672-3744.
    if (pendingLocalToolCalls.length > 0) {
      if (!previousResponseId) {
        throw new Error(
          'Unable to pause generation for local tools: missing previous_response_id',
        );
      }
      const seq = await this.deps.streamSequencer.allocate(streamId);
      await this.deps.streamBuffer.append(
        streamId,
        'status',
        {
          state: 'awaiting_local_tool_results',
          previous_response_id: previousResponseId,
          pending_local_tool_calls: pendingLocalToolCalls.map((item) => ({
            tool_call_id: item.id,
            name: item.name,
            args: item.args,
          })),
          local_tool_definitions: localTools.map((tool) => ({
            name: tool.type === 'function' ? tool.function.name : '',
            description:
              tool.type === 'function'
                ? tool.function.description ?? ''
                : '',
            parameters:
              tool.type === 'function'
                ? ((tool.function.parameters ?? {}) as Record<
                    string,
                    unknown
                  >)
                : {},
          })),
          base_tool_outputs: responseToolOutputs.map((item) => ({
            call_id: item.call_id,
            output: item.output,
          })),
          vscode_code_agent: vscodeCodeAgentPayload
            ? {
                source: 'vscode',
                workspace_key: vscodeCodeAgentPayload.workspaceKey,
                workspace_label: vscodeCodeAgentPayload.workspaceLabel,
                prompt_global_override:
                  vscodeCodeAgentPayload.promptGlobalOverride,
                prompt_workspace_override:
                  vscodeCodeAgentPayload.promptWorkspaceOverride,
                instruction_include_patterns:
                  vscodeCodeAgentPayload.instructionIncludePatterns,
                instruction_files:
                  vscodeCodeAgentPayload.instructionFiles.map((file) => ({
                    path: file.path,
                    content: file.content,
                  })),
                system_context: vscodeCodeAgentPayload.systemContext
                  ? {
                      working_directory:
                        vscodeCodeAgentPayload.systemContext.workingDirectory,
                      is_git_repo:
                        vscodeCodeAgentPayload.systemContext.isGitRepo,
                      git_branch:
                        vscodeCodeAgentPayload.systemContext.gitBranch,
                      platform:
                        vscodeCodeAgentPayload.systemContext.platform,
                      os_version:
                        vscodeCodeAgentPayload.systemContext.osVersion,
                      shell: vscodeCodeAgentPayload.systemContext.shell,
                      client_date_iso:
                        vscodeCodeAgentPayload.systemContext.clientDateIso,
                      client_timezone:
                        vscodeCodeAgentPayload.systemContext.clientTimezone,
                    }
                  : undefined,
              }
            : undefined,
        },
        seq,
        streamId,
      );
      streamSeq = seq + 1;
      return {
        shouldExitGeneration: true,
        streamSeq,
        currentMessages,
        previousResponseId,
        pendingResponsesRawInput: responseToolOutputs,
        todoContinuationActive,
        todoAwaitingUserInput,
      };
    }

    // Block C — OPTION 1 (Responses API): on CONTINUE via previous_response_id +
    // function_call_output -> pas d'injection tool->user JSON, pas de
    // "role:tool" dans messages. On laisse `previousResponseId` alimenter
    // l'appel suivant. Pour l'historique local côté modèle, on n'ajoute
    // l'assistant que si non vide.
    // Verbatim port of chat-service.ts lines 3746-3781.
    const assistantText = contentParts.join('');
    if (assistantText.trim()) {
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: assistantText },
      ];
    }

    // Non-Responses-API providers (Claude, Mistral, Cohere, Codex) need both
    // function_call + function_call_output in rawInput so the runtime can
    // reconstruct the assistant tool_use / tool_calls block before tool results.
    const needsExplicitToolReplay =
      useCodexTransport ||
      providerId === 'anthropic' ||
      providerId === 'mistral' ||
      providerId === 'cohere';
    let pendingResponsesRawInput: ReadonlyArray<unknown>;
    if (needsExplicitToolReplay) {
      if (useCodexTransport) previousResponseId = null;
      pendingResponsesRawInput = toolCalls.flatMap((toolCall) => {
        const output = responseToolOutputs.find(
          (item) => item.call_id === toolCall.id,
        );
        return output
          ? [
              {
                type: 'function_call' as const,
                call_id: toolCall.id,
                name: toolCall.name,
                arguments: toolCall.args || '{}',
              },
              output,
            ]
          : [];
      });
    } else {
      pendingResponsesRawInput = responseToolOutputs;
    }

    return {
      shouldExitGeneration: false,
      streamSeq,
      currentMessages,
      previousResponseId,
      pendingResponsesRawInput,
      todoContinuationActive,
      todoAwaitingUserInput,
    };
  }

  /**
   * BR14b Lot 21e-3 — terminal finalization slice of
   * `runAssistantGeneration`.
   *
   * Verbatim port of `chat-service.ts` lines 3892-3902 (post-Lot 21e-2):
   * emit the single `done` stream event, persist the final assistant
   * content + reasoning via `MessageStore.updateAssistantContent`, and
   * touch the session `updatedAt` via `SessionStore.touchUpdatedAt`.
   *
   * Stays in the runtime because both stores live on `deps`. Stream
   * event emission goes through `deps.streamSequencer.allocate` +
   * `deps.streamBuffer.append` per the Lot 20 contract.
   */
  async emitFinalAssistantTurn(
    input: EmitFinalAssistantTurnInput,
  ): Promise<EmitFinalAssistantTurnResult> {
    const {
      streamId,
      assistantMessageId,
      sessionId,
      content,
      reasoning,
      model,
    } = input;
    const seq = await this.deps.streamSequencer.allocate(streamId);
    await this.deps.streamBuffer.append(
      streamId,
      'done',
      {},
      seq,
      streamId,
    );
    const streamSeq = seq + 1;
    await this.deps.messageStore.updateAssistantContent(assistantMessageId, {
      content,
      reasoning,
      model,
    });
    await this.deps.sessionStore.touchUpdatedAt(sessionId);
    return { streamSeq };
  }

  /**
   * BR14b Lot 22a-2 — pass2 fallback slice of `runAssistantGeneration`.
   *
   * Verbatim port of `chat-service.ts` lines 3707-3813 post-Lot 22a-1
   * (~107l). Triggered AFTER the main tool loop + per-iteration
   * `finalizeAssistantIteration` finish and BEFORE `emitFinalAssistantTurn`:
   * when the assistant produced no usable content
   * (`!contentParts.join('').trim()`), force a clean second pass with
   * tools disabled to coerce a final user-facing response.
   *
   * Behavior (verbatim — STRICT preservation):
   *   1. Guard: return `{skipped:true, streamSeq, lastErrorMessage:null}`
   *      when `contentParts.join('').trim()` is non-empty (the caller
   *      then proceeds to `emitFinalAssistantTurn`).
   *   2. Build pass2 system prompt (`systemPrompt + <FR directives>`) +
   *      pass2 messages (system + conversation + synthesized user
   *      message with the digest of executed tools).
   *   3. Reset `contentParts`, `reasoningParts`, `lastErrorMessage`
   *      (in-place mutation of the caller's mutable arrays).
   *   4. Optionally emit the `pass2_prompt` trace via the Option A
   *      `writeChatGenerationTrace` callback.
   *   5. Stream via `deps.mesh.invokeStream` with `tools=undefined`,
   *      `toolChoice='none'`, `reasoningSummary='detailed'`. For each
   *      non-`done` event: append to the stream buffer via
   *      `deps.streamSequencer.allocate` + `deps.streamBuffer.append`,
   *      advance `streamSeq`, capture `content_delta` /
   *      `reasoning_delta` into the caller's buffers, capture
   *      `error.message` into `lastErrorMessage`.
   *   6. On thrown error during streaming: emit a final `error` event
   *      then rethrow (mirrors the inline `try/catch` at lines 3791-3805).
   *   7. After streaming completes: throw
   *      `'Second pass produced no content'` if `contentParts` is still
   *      empty (after emitting the error event).
   *
   * Option A callbacks (same pattern as Lots 16a/16b/18/21c/21e-1/21e-3/22a-1):
   *   - `writeChatGenerationTrace` — optional pass2 trace emission.
   *     When undefined (test harness / minimal runtime) the trace is
   *     silently skipped. When defined, called with the verbatim
   *     `{kind:'pass2_prompt', callSite:'ChatService.runAssistantGeneration/pass2/beforeOpenAI', openaiApi:'responses'}`
   *     meta shape.
   *
   * Mesh dispatch goes through `this.deps.mesh.invokeStream` (Lot 10
   * port) so chat-core stays free of any `callLLMStream` /
   * `api/src/services/llm-runtime` direct dep. Stream event emission
   * goes through `deps.streamSequencer.allocate` + `deps.streamBuffer.append`
   * (Lot 20 contract — same convention as `consumeAssistantStream` /
   * `applyContextBudgetGate` / `finalizeAssistantIteration`).
   */
  async runPass2Fallback(
    input: RunPass2FallbackInput,
  ): Promise<RunPass2FallbackResult> {
    const {
      streamId,
      assistantMessageId,
      sessionId,
      userId,
      workspaceId,
      providerId,
      model,
      credential,
      signal,
      reasoningEffort,
      conversation,
      executedTools,
      systemPrompt,
      contentParts,
      reasoningParts,
      streamSeq: streamSeqInput,
      traceEnabled,
      writeChatGenerationTrace,
    } = input;
    let streamSeq = streamSeqInput;
    let lastErrorMessage: string | null = null;

    // Guard — verbatim port of chat-service.ts line 3709:
    //   `if (!contentParts.join('').trim()) { ... }`
    if (contentParts.join('').trim()) {
      return { skipped: true, streamSeq, lastErrorMessage: null };
    }

    // Build pass2 system + pass2 messages — verbatim port of
    // chat-service.ts lines 3710-3729.
    const lastUserMessage =
      [...conversation].reverse().find((m) => m.role === 'user')?.content ??
      '';
    const digest = buildToolDigestForRuntime(executedTools);
    const pass2System =
      systemPrompt +
      `\n\nIMPORTANT: Tu dois maintenant produire une réponse finale à l'utilisateur.\n` +
      `- Tu n'as pas le droit d'appeler d'outil (tools désactivés).\n` +
      `- Tu dois répondre en français, de manière concise et actionnable.\n` +
      `- Si une information manque, dis-le explicitement.\n`;

    const pass2Messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
    }> = [
      { role: 'system', content: pass2System },
      ...conversation,
      {
        role: 'user',
        content:
          `Demande utilisateur: ${lastUserMessage}\n\n` +
          `Résultats disponibles (outils déjà exécutés):\n${digest}\n\n` +
          `Rédige maintenant la réponse finale.`,
      },
    ];

    // Reset buffers for final content — verbatim port of
    // chat-service.ts lines 3732-3734.
    contentParts.length = 0;
    reasoningParts.length = 0;
    lastErrorMessage = null;

    try {
      // Pass2 prompt trace — verbatim port of chat-service.ts lines
      // 3737-3751. Optional Option A callback (skipped silently when
      // undefined).
      if (writeChatGenerationTrace) {
        await writeChatGenerationTrace({
          enabled: traceEnabled,
          sessionId,
          assistantMessageId,
          userId,
          workspaceId,
          phase: 'pass2',
          iteration: 1,
          model: model || null,
          toolChoice: 'none',
          tools: null,
          openaiMessages: pass2Messages,
          toolCalls: null,
          meta: {
            kind: 'pass2_prompt',
            callSite:
              'ChatService.runAssistantGeneration/pass2/beforeOpenAI',
            openaiApi: 'responses',
          },
        });
      }

      // Pass2 mesh stream — verbatim port of chat-service.ts lines
      // 3753-3790. Mesh dispatch goes through `deps.mesh.invokeStream`
      // (Lot 10 port). Event taxonomy mirrors the legacy
      // `callLLMStream` shape: per-event `writeStreamEvent` +
      // `streamSeq += 1`, accumulating `content_delta` /
      // `reasoning_delta` into the caller's mutable buffers.
      for await (const event of this.deps.mesh.invokeStream({
        providerId,
        model,
        credential,
        userId,
        workspaceId: workspaceId ?? undefined,
        messages: pass2Messages,
        tools: undefined,
        toolChoice: 'none',
        reasoningSummary: 'detailed',
        reasoningEffort,
        signal,
      })) {
        const eventType = event.type;
        const data = (event.data ?? {}) as Record<string, unknown>;
        if (eventType === 'done') {
          continue;
        }
        if (eventType === 'error') {
          const msg = (data as Record<string, unknown>).message;
          lastErrorMessage =
            typeof msg === 'string' ? msg : 'Unknown error';
          const errSeq =
            await this.deps.streamSequencer.allocate(streamId);
          await this.deps.streamBuffer.append(
            streamId,
            eventType as StreamEventTypeName,
            data,
            errSeq,
            streamId,
          );
          streamSeq = errSeq + 1;
          continue;
        }
        // On stream les deltas pass2 sur le même streamId.
        const seq = await this.deps.streamSequencer.allocate(streamId);
        await this.deps.streamBuffer.append(
          streamId,
          eventType as StreamEventTypeName,
          data,
          seq,
          streamId,
        );
        streamSeq = seq + 1;
        if (eventType === 'content_delta') {
          const delta = typeof data.delta === 'string' ? data.delta : '';
          if (delta) {
            contentParts.push(delta);
          }
        } else if (eventType === 'reasoning_delta') {
          const delta = typeof data.delta === 'string' ? data.delta : '';
          if (delta) reasoningParts.push(delta);
        }
      }
    } catch (e) {
      // Verbatim port of chat-service.ts lines 3791-3805 — emit a
      // final `error` event then rethrow. The caller propagates the
      // error up the job queue.
      const message =
        lastErrorMessage ||
        (e instanceof Error ? e.message : 'Second pass failed');
      const errSeq = await this.deps.streamSequencer.allocate(streamId);
      await this.deps.streamBuffer.append(
        streamId,
        'error' satisfies StreamEventTypeName,
        { message },
        errSeq,
        streamId,
      );
      streamSeq = errSeq + 1;
      throw e;
    }

    // Verbatim port of chat-service.ts lines 3807-3812 — throw when
    // the second pass still produced no content (post-error event
    // emission for downstream consumers).
    if (!contentParts.join('').trim()) {
      const message = 'Second pass produced no content';
      const errSeq = await this.deps.streamSequencer.allocate(streamId);
      await this.deps.streamBuffer.append(
        streamId,
        'error' satisfies StreamEventTypeName,
        { message },
        errSeq,
        streamId,
      );
      streamSeq = errSeq + 1;
      throw new Error(message);
    }

    return { skipped: false, streamSeq, lastErrorMessage };
  }
}

