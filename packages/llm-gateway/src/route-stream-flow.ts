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

const usageFromEvent = (event: StreamEvent): SettleUsage | undefined =>
  event.type === 'done' ? routeUsage(event.data.usage) : undefined;

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
  let reported: SettleUsage | undefined;
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
        yield event;
        next = await iterator.next();
      }
      throw new Error('stream ended without terminal event');
    } catch (error) {
      if (terminal) throw error; // callback failure: never record/settle again
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
  return { encoded, expose };
};

export const runRouteStreamFlow = async (
  deps: RouteFlowDeps,
  request: GatewayFlowRequest,
): Promise<GatewayStreamResult> => {
  const prepared = await prepareRouteFlow(deps, request);
  const attempts: RouteAttemptSettlement[] = [];
  for (let index = 0; index < prepared.plan.candidateRefs.length; index += 1) {
    const candidateRef = prepared.plan.candidateRefs[index]!;
    const diagnostic = prepared.plan.diagnostics[index]!;
    let attempt: PreparedRouteAttempt | undefined;
    let iterator: AsyncIterator<StreamEvent> | undefined;
    try {
      attempt = await deps.routePlanner.prepareAttempt(
        prepared.subject, prepared.plan.planRef, candidateRef, prepared.cost.correlationId, index,
      );
      const preparedAttempt = attempt;
      const source = await (deps.dispatch ?? defaultDispatch).stream({ attempt: preparedAttempt, request: {
        ...prepared.canonical.request,
        ...(request.signal ? { signal: request.signal } : {}),
      } });
      iterator = source[Symbol.asyncIterator]();
      let first = await iterator.next();
      while (!first.done && (first.value.type === 'status' || first.value.type === 'tool_call_result')) {
        first = await iterator.next();
      }
      if (first.done) throw { code: 'empty_stream' };
      if (first.value.type === 'error') throw first.value.data;
      await preparedAttempt.markCommitted();
      let usage = usageFromEvent(first.value) ?? routeUsage();
      let terminal = false;
      const settle = async (outcome: 'success' | 'failed' | 'cancelled') => {
        if (terminal) return;
        terminal = true;
        await deps.metering.settleRoute({
          cost: prepared.cost, wire: request.wire, requestedModel: request.model,
          outcome, usage: aggregateUsage(attempts), attempts,
        });
      };
      const cancel = async () => {
        await iterator?.return?.();
        if (terminal) return;
        await preparedAttempt.releaseCancelled();
        attempts.push({
          candidateRef, providerId: diagnostic.actualProviderId,
          modelId: diagnostic.actualModelId,
          transportProviderId: diagnostic.actualTransportProviderId,
          outcome: 'cancelled', usage,
        });
        await settle('cancelled');
      };
      const tracked = (async function* (): AsyncGenerator<StreamEvent> {
        let completed = false;
        let providerErrorEmitted = false;
        try {
          yield first.value;
          for (let next = await iterator!.next(); !next.done; next = await iterator!.next()) {
            usage = usageFromEvent(next.value) ?? usage;
            yield next.value;
            if (next.value.type === 'error') {
              providerErrorEmitted = true;
              throw next.value.data;
            }
          }
          completed = true;
          await preparedAttempt.complete(attemptUsage(usage));
          attempts.push({
            candidateRef, providerId: diagnostic.actualProviderId,
            modelId: diagnostic.actualModelId,
            transportProviderId: diagnostic.actualTransportProviderId,
            outcome: 'success', usage,
          });
          await settle('success');
        } catch (error) {
          const classification = classifyRouteError(error, request.signal?.aborted);
          if (classification.reason === 'cancelled') await preparedAttempt.releaseCancelled();
          else await preparedAttempt.recordOutcome(classification, attemptUsage(usage));
          attempts.push({
            candidateRef, providerId: diagnostic.actualProviderId,
            modelId: diagnostic.actualModelId,
            transportProviderId: diagnostic.actualTransportProviderId,
            outcome: classification.reason, usage,
          });
          await settle(classification.reason === 'cancelled' ? 'cancelled' : 'failed');
          if (classification.reason !== 'cancelled' && !providerErrorEmitted) {
            yield {
              type: 'error',
              data: {
                providerId: diagnostic.actualProviderId as never,
                message: 'stream failed after commitment', retryable: false,
              },
            };
          }
        } finally {
          if (!completed) await cancel();
        }
      })();
      const responseId = first.value.type === 'done'
        ? first.value.data.responseId ?? prepared.cost.correlationId
        : first.value.type === 'status'
          ? first.value.data.sentropicResponseId ?? prepared.cost.correlationId
          : prepared.cost.correlationId;
      const encoded = encodeGatewayStream(
        request.wire, diagnostic.actualModelId, responseId, tracked,
        request.wire === 'anthropic-messages'
          ? { anthropicInputTokens: estimateAnthropicInputTokens(prepared.canonical.request) }
          : undefined,
      );
      return { servedTarget: servedTargetFor(diagnostic), stream: (async function* () {
        try { yield* encoded; }
        finally {
          await encoded.return(undefined);
          await cancel();
        }
      })() };
    } catch (error) {
      await iterator?.return?.();
      const classification = classifyRouteError(error, request.signal?.aborted);
      const usage = routeUsage();
      if (attempt) {
        if (classification.reason === 'cancelled') await attempt.releaseCancelled();
        else await attempt.recordOutcome(classification, attemptUsage(usage));
      }
      attempts.push({
        candidateRef, providerId: diagnostic.actualProviderId,
        modelId: diagnostic.actualModelId,
        transportProviderId: diagnostic.actualTransportProviderId,
        outcome: classification.reason, usage,
      });
      if (classification.retryable && index + 1 < prepared.plan.candidateRefs.length) continue;
      await deps.metering.settleRoute({
        cost: prepared.cost, wire: request.wire, requestedModel: request.model,
        outcome: classification.reason === 'cancelled' ? 'cancelled' : 'failed',
        usage: aggregateUsage(attempts), attempts,
      });
      // Same terminal-class preservation as the JSON flow: a terminal
      // upstream refusal keeps its class, never a pooled 503.
      throw terminalGatewayError(
        classification, servedTargetFor(diagnostic), 'all planned streams failed',
      );
    }
  }
  throw new GatewayError('no-eligible-account', 'route plan has no candidates');
};
