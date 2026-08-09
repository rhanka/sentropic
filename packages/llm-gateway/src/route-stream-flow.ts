import type { StreamEvent } from '@sentropic/llm-mesh';
import { encodeGatewayStream } from './canonical-stream.js';
import type { GatewayFlowRequest, GatewayStreamResult, SettleUsage } from './flow.js';
import {
  aggregateUsage, attemptUsage, classifyRouteError, prepareRouteFlow, routeUsage,
  type RouteAttemptSettlement, type RouteFlowDeps,
} from './route-flow-core.js';
import { GatewayError } from './router/errors.js';

const usageFromEvent = (event: StreamEvent): SettleUsage | undefined =>
  event.type === 'done' ? routeUsage(event.data.usage) : undefined;

export const runRouteStreamFlow = async (
  deps: RouteFlowDeps,
  request: GatewayFlowRequest,
): Promise<GatewayStreamResult> => {
  const prepared = await prepareRouteFlow(deps, request);
  const attempts: RouteAttemptSettlement[] = [];
  for (let index = 0; index < prepared.plan.candidateRefs.length; index += 1) {
    const candidateRef = prepared.plan.candidateRefs[index]!;
    const diagnostic = prepared.plan.diagnostics[index]!;
    const attempt = await deps.routePlanner.prepareAttempt(
      prepared.subject, prepared.plan.planRef, candidateRef, prepared.cost.correlationId, index,
    );
    let iterator: AsyncIterator<StreamEvent> | undefined;
    try {
      const source = await attempt.stream({
        ...prepared.canonical.request,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      iterator = source[Symbol.asyncIterator]();
      let first = await iterator.next();
      while (!first.done && (first.value.type === 'status' || first.value.type === 'tool_call_result')) {
        first = await iterator.next();
      }
      if (first.done) throw { code: 'empty_stream' };
      if (first.value.type === 'error') throw first.value.data;
      await attempt.markCommitted();
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
        await attempt.releaseCancelled();
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
          await attempt.complete(attemptUsage(usage));
          attempts.push({
            candidateRef, providerId: diagnostic.actualProviderId,
            modelId: diagnostic.actualModelId,
            transportProviderId: diagnostic.actualTransportProviderId,
            outcome: 'success', usage,
          });
          await settle('success');
        } catch (error) {
          const classification = classifyRouteError(error, request.signal?.aborted);
          if (classification.reason === 'cancelled') await attempt.releaseCancelled();
          else await attempt.recordOutcome(classification, attemptUsage(usage));
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
      );
      return { stream: (async function* () {
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
      if (classification.reason === 'cancelled') await attempt.releaseCancelled();
      else await attempt.recordOutcome(classification, attemptUsage(usage));
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
      throw new GatewayError('pooled-account-unavailable', 'all planned streams failed');
    }
  }
  throw new GatewayError('no-eligible-account', 'route plan has no candidates');
};
