import type { PreparedRouteAttempt, StreamEvent, RouteFailureClassification } from '@sentropic/llm-mesh';
import { encodeGatewayStream, estimateAnthropicInputTokens } from './canonical-stream.js';
import type { GatewayFlowRequest, GatewayStreamResult, ResolvedTarget, SettleUsage } from './flow.js';
import {
  aggregateUsage, attemptUsage, classifyRouteError, prepareRouteFlow, routeUsage, terminalGatewayError,
  type RouteAttemptSettlement, type RouteFlowDeps, type PreparedRouteFlow,
} from './route-flow-core.js';
import { GatewayError } from './router/errors.js';
import { RouteAttemptDispatch } from './route-attempt-dispatch.js';
const defaultDispatch = new RouteAttemptDispatch();

const errorUsage = (error: unknown): SettleUsage | undefined => {
  const usage = error && typeof error === 'object' ? (error as { usage?: SettleUsage }).usage : undefined;
  return usage ? { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0,
    estimated: usage.estimated ?? false } : undefined;
};

const servedTargetFor = (diagnostic: {
  readonly actualProviderId: string;
  readonly actualTransportProviderId: string;
  readonly actualModelId: string;
}): ResolvedTarget => ({
  providerId: diagnostic.actualProviderId,
  transportProviderId: diagnostic.actualTransportProviderId,
  model: diagnostic.actualModelId,
});

/** Claim the terminal outcome before awaiting any callback or iterator cleanup. */
const trackedExecution = (input: {
  attempt: PreparedRouteAttempt; iterator: AsyncIterator<StreamEvent>; first: StreamEvent;
  prepared: PreparedRouteFlow; request: GatewayFlowRequest; target: ResolvedTarget;
  candidateRef: string; attempts: RouteAttemptSettlement[]; responseId: string;
  settle: (outcome: 'success' | 'failed' | 'cancelled') => Promise<void>;
}) => {
  const { attempt, iterator, prepared, request, target } = input;
  const signal = request.signal ?? request.authContext.signal;
  let terminal: RouteFailureClassification['reason'] | undefined;
  let finishing: Promise<void> | undefined;
  let closing: Promise<unknown> | undefined;
  let outputCharacters = 0;
  let reported = input.first.type === 'done' && input.first.data.usage ? routeUsage(input.first.data.usage) : undefined;
  const isCancelled = () => terminal === 'cancelled';
  const close = () => closing ??= Promise.resolve().then(() => iterator.return?.()).catch(() => undefined);
  const usage = (): SettleUsage => reported ?? ({
    inputTokens: Math.min(1_000_000, estimateAnthropicInputTokens(prepared.canonical.request)),
    outputTokens: Math.min(1_000_000, Math.ceil(outputCharacters / 4)), estimated: true,
  });
  const finish = (classification: RouteFailureClassification): Promise<void> => {
    if (terminal) return finishing ?? Promise.resolve();
    terminal = classification.reason;
    signal?.removeEventListener('abort', onAbort);
    const finalUsage = usage();
    input.attempts.push({ candidateRef: input.candidateRef, providerId: target.providerId,
      modelId: target.model, transportProviderId: target.transportProviderId,
      outcome: terminal, usage: finalUsage });
    finishing = (async () => {
      try {
        if (terminal === 'success') await attempt.complete(attemptUsage(finalUsage));
        else if (terminal === 'cancelled') await attempt.releaseCancelled();
        else await attempt.recordOutcome(classification, attemptUsage(finalUsage));
      } finally {
        await input.settle(terminal === 'success' ? 'success' : terminal === 'cancelled' ? 'cancelled' : 'failed');
      }
    })();
    return finishing;
  };
  const cancel = async () => {
    const result = finish({ reason: 'cancelled', retryable: false, healthScope: 'route' });
    await Promise.all([result, close()]);
  };
  const onAbort = () => { void cancel().catch(() => undefined); };
  const tracked = (async function* (): AsyncGenerator<StreamEvent> {
    try {
      let next: IteratorResult<StreamEvent> = { done: false, value: input.first };
      while (!next.done) {
        signal?.throwIfAborted();
        if (isCancelled()) return;
        const event = next.value;
        if (event.type === 'error') throw event.data;
        if (event.type === 'done') {
          if (event.data.usage) reported = routeUsage(event.data.usage);
          await finish({ reason: 'success', retryable: false, healthScope: 'route' });
          yield event;
          return;
        }
        if (event.type === 'content_delta' || event.type === 'reasoning_delta' || event.type === 'tool_call_delta') {
          outputCharacters = Math.min(4_000_000, outputCharacters + event.data.delta.length);
        }
        if (event.type === 'tool_call_start') outputCharacters = Math.min(4_000_000,
          outputCharacters + (event.data.argumentsText?.length ?? 0));
        yield event;
        next = await iterator.next();
      }
      throw new Error('stream ended without terminal event');
    } catch (error) {
      if (terminal) throw error; // callback failure: never record/settle again
      reported = errorUsage(error) ?? reported;
      const classification = classifyRouteError(error, signal?.aborted);
      await finish(classification);
      if (classification.reason !== 'cancelled') yield { type: 'error', data: {
        providerId: target.providerId as never,
        message: 'stream failed after commitment', retryable: false,
      } };
    } finally { await close(); }
  })();
  const encoded = encodeGatewayStream(request.wire, target.model, input.responseId, tracked,
    request.wire === 'anthropic-messages'
      ? { anthropicInputTokens: estimateAnthropicInputTokens(prepared.canonical.request) } : undefined);
  const expose = (first: IteratorResult<import('./ports/dispatch.js').GatewayDispatchStreamEvent>) => {
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const stream = (async function* () {
      try {
        signal?.throwIfAborted();
        if (isCancelled()) return;
        if (!first.done) yield first.value;
        for await (const frame of encoded) {
          signal?.throwIfAborted();
          if (isCancelled()) return;
          yield frame;
        }
      } finally {
        await encoded.return(undefined);
        if (!terminal) await cancel();
        else await close();
        signal?.removeEventListener('abort', onAbort);
      }
    })();
    const originalReturn = stream.return.bind(stream);
    stream.return = async value => { await cancel(); await encoded.return(undefined); return originalReturn(value); };
    return stream;
  };
  return { encoded, expose, get terminal() { return terminal; } };
};

export const runRouteStreamFlow = async (
  deps: RouteFlowDeps,
  request: GatewayFlowRequest,
): Promise<GatewayStreamResult> => {
  const prepared = await prepareRouteFlow(deps, request);
  const attempts: RouteAttemptSettlement[] = [];
  const signal = request.signal ?? request.authContext.signal;
  let settled = false;
  const settle = async (outcome: 'success' | 'failed' | 'cancelled') => {
    if (settled) return;
    settled = true;
    await deps.metering.settleRoute({ cost: prepared.cost, wire: request.wire, requestedModel: request.model,
      outcome, usage: aggregateUsage(attempts), attempts });
  };
  for (let index = 0; index < prepared.plan.candidateRefs.length; index += 1) {
    const candidateRef = prepared.plan.candidateRefs[index]!;
    const diagnostic = prepared.plan.diagnostics[index]!;
    let attempt: PreparedRouteAttempt | undefined;
    let iterator: AsyncIterator<StreamEvent> | undefined;
    let committed = false;
    let invoked = false;
    let execution: ReturnType<typeof trackedExecution> | undefined;
    try {
      signal?.throwIfAborted();
      attempt = await deps.routePlanner.prepareAttempt(
        prepared.subject, prepared.plan.planRef, candidateRef, prepared.cost.correlationId, index,
      );
      const preparedAttempt = attempt;
      signal?.throwIfAborted();
      invoked = true;
      const source = await (deps.dispatch ?? defaultDispatch).stream({ attempt: preparedAttempt, request: {
        ...prepared.canonical.request,
        ...(signal ? { signal } : {}),
      } });
      iterator = source[Symbol.asyncIterator]();
      let first = await iterator.next();
      let responseId = prepared.cost.correlationId;
      const headers: Record<string, string> = {};
      while (!first.done && (first.value.type === 'status' || first.value.type === 'tool_call_result')) {
        signal?.throwIfAborted();
        if (first.value.type === 'status') {
          responseId = first.value.data.sentropicResponseId ?? responseId;
          const metadataHeaders = first.value.data.metadata?.responseHeaders;
          if (metadataHeaders && typeof metadataHeaders === 'object') {
            for (const [key, value] of Object.entries(metadataHeaders)) {
              if (typeof value === 'string') headers[key.toLowerCase()] = value;
            }
          }
        }
        first = await iterator.next();
      }
      signal?.throwIfAborted();
      if (first.done) throw { code: 'empty_stream' };
      if (first.value.type === 'error') throw first.value.data;
      if (first.value.type === 'done') responseId = first.value.data.responseId ?? responseId;
      execution = trackedExecution({ attempt: preparedAttempt, iterator, first: first.value,
        prepared, request, target: servedTargetFor(diagnostic), candidateRef, attempts, responseId, settle });
      const frame = await execution.encoded.next();
      if (frame.done || typeof frame.value.raw !== "string" || !frame.value.raw) throw Error("empty encoded stream");
      committed = true;
      await preparedAttempt.markCommitted();
      signal?.throwIfAborted();
      return { servedTarget: servedTargetFor(diagnostic), headers, stream: execution.expose(frame) };
    } catch (error) {
      if (execution?.terminal) throw error;
      try { await iterator?.return?.(); } catch { /* Cleanup must not erase the terminal outcome. */ }
      const classification = classifyRouteError(error, signal?.aborted);
      const usage = errorUsage(error) ?? (invoked ? {
        inputTokens: Math.min(1_000_000, estimateAnthropicInputTokens(prepared.canonical.request)),
        outputTokens: 0, estimated: true,
      } : routeUsage());
      attempts.push({
        candidateRef, providerId: diagnostic.actualProviderId,
        modelId: diagnostic.actualModelId,
        transportProviderId: diagnostic.actualTransportProviderId,
        outcome: classification.reason, usage,
      });
      try {
        if (attempt) {
          if (classification.reason === 'cancelled') await attempt.releaseCancelled();
          else await attempt.recordOutcome(classification, attemptUsage(usage));
        }
      } catch (hookError) { await settle('failed'); throw hookError; }
      if (!committed && classification.retryable && index + 1 < prepared.plan.candidateRefs.length) continue;
      await settle(classification.reason === 'cancelled' ? 'cancelled' : 'failed');
      // Same terminal-class preservation as the JSON flow: a terminal
      // upstream refusal keeps its class, never a pooled 503.
      throw terminalGatewayError(
        classification, servedTargetFor(diagnostic), 'all planned streams failed',
      );
    }
  }
  await settle('failed');
  throw new GatewayError('no-eligible-account', 'route plan has no candidates');
};
