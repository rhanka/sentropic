import type { NativeMessagesRequest, NativeUsageTermination, PreparedRouteAttempt, RouteFailureClassification } from '@sentropic/llm-mesh';
import { NativeMessagesUpstreamError } from '@sentropic/llm-mesh';
import type { ResolvedTarget } from './flow.js';
import { classifyRouteError, attemptUsage, type RouteAttemptSettlement } from './route-flow-core.js';
import { NativeUsageObserver } from './native-usage.js';
import { nativeLifecycle } from './native-lifecycle.js';
import { parseNativeSseStream, NativeSseFrameOverflowError, type NativeSseFrame } from './native-sse.js';
import { nativeFrameError, nativeLateErrorBytes } from './native-stream-errors.js';

export const nativeStreamTermination = (error: unknown, aborted = false): NativeUsageTermination =>
  aborted ? 'cancelled' : error instanceof NativeSseFrameOverflowError ? 'frame_overflow'
    : error instanceof NativeMessagesUpstreamError ? error.code === 'timeout' ? 'timeout'
      : error.code === 'native_protocol_error' ? 'protocol_error' : 'upstream_error' : 'reader_error';

/** Response-only execution state; commitment belongs to the caller of prime(). */
export const nativeStreamExecution = (input: {
  attempt: PreparedRouteAttempt; observer: NativeUsageObserver; controller: AbortController;
  signal?: AbortSignal; target: ResolvedTarget; candidateRef: string; attempts: RouteAttemptSettlement[];
  requestId: string; finalize?: NativeMessagesRequest['finalize'];
  features: { requestSafeguards: boolean; sentBetas: readonly string[] };
  settle: (outcome: 'success' | 'failed' | 'cancelled') => Promise<void>;
}) => {
  let raw: AsyncIterator<Uint8Array> | undefined;
  let frames: AsyncGenerator<NativeSseFrame, void, undefined> | undefined;
  let first: NativeSseFrame | undefined;
  let stopped = false;
  let terminal = false;
  let cancelled = false;
  let resolveAbort!: () => void;
  const aborted = new Promise<void>(resolve => { resolveAbort = resolve; });
  const lifecycle = nativeLifecycle(input.observer, input.finalize,
    { requestId: input.requestId, attemptRef: input.attempt.attemptRef });
  let finishing: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const closeRaw = () => closing ??= Promise.resolve().then(() => raw?.return?.()).then(() => undefined, () => undefined);
  const close = () => {
    input.signal?.removeEventListener('abort', onAbort);
    input.controller.abort();
    void frames?.return(undefined).catch(() => undefined);
    return closeRaw();
  };
  const read = async () => {
    const next = await Promise.race([
      frames!.next().then(value => ({ kind: 'frame' as const, value })),
      aborted.then(() => ({ kind: 'aborted' as const })),
    ]);
    if (next.kind === 'aborted') throw new DOMException('Native stream cancelled', 'AbortError');
    return next.value;
  };
  const observe = (frame: NativeSseFrame) => {
    const error = nativeFrameError(frame, input.features);
    if (error) throw error;
    input.observer.observeFrame(frame);
    let type = frame.event;
    if (!type && frame.data) { try { type = JSON.parse(frame.data)?.type; } catch { /* Opaque event. */ } }
    stopped ||= type === 'message_stop';
  };
  const finish = (classification: RouteFailureClassification, termination: NativeUsageTermination,
    settleNow = true): Promise<void> => {
    if (terminal) return finishing ?? Promise.resolve();
    terminal = true;
    cancelled = classification.reason === 'cancelled';
    input.signal?.removeEventListener('abort', onAbort);
    const usage = lifecycle.usage(termination);
    input.attempts.push({ candidateRef: input.candidateRef, providerId: input.target.providerId,
      modelId: input.target.model, transportProviderId: input.target.transportProviderId,
      outcome: classification.reason, usage });
    finishing = (async () => {
      try {
        if (classification.reason === 'success') await input.attempt.complete(attemptUsage(usage));
        else if (classification.reason === 'cancelled') await input.attempt.releaseCancelled();
        else await input.attempt.recordOutcome(classification, attemptUsage(usage));
      } finally {
        if (settleNow) await input.settle(classification.reason === 'success' ? 'success'
          : classification.reason === 'cancelled' ? 'cancelled' : 'failed');
      }
    })();
    return finishing;
  };
  const cancel = async () => {
    resolveAbort();
    const done = finish({ reason: 'cancelled', retryable: false, healthScope: 'route' }, 'cancelled');
    await Promise.all([done, close()]);
  };
  const onAbort = () => {
    input.controller.abort(input.signal?.reason);
    resolveAbort();
    if (raw) void cancel().catch(() => undefined);
  };
  input.signal?.addEventListener('abort', onAbort, { once: true });
  if (input.signal?.aborted) onAbort();
  const prime = async (source: AsyncIterable<Uint8Array>) => {
    raw = source[Symbol.asyncIterator]();
    frames = parseNativeSseStream({ [Symbol.asyncIterator]: () => ({
      next: () => raw!.next(), return: async () => { await closeRaw(); return { done: true as const, value: undefined }; },
    }) });
    if (input.signal?.aborted) onAbort();
    const next = await read();
    input.signal?.throwIfAborted();
    if (next.done) throw Object.assign(Error('Native stream is empty'), { code: 'empty_stream' });
    first = next.value;
    observe(first);
  };
  const expose = () => {
    const stream = (async function* () {
      try {
        input.signal?.throwIfAborted();
        if (terminal) return;
        yield { bytes: first!.rawBytes };
        for (let next = await read(); !next.done; next = await read()) {
          input.signal?.throwIfAborted();
          if (terminal) return;
          observe(next.value);
          yield { bytes: next.value.rawBytes };
        }
        if (!stopped) {
          await finish({ reason: 'provider-5xx', retryable: false, healthScope: 'route' }, 'missing_message_stop');
          yield { bytes: nativeLateErrorBytes(undefined) };
        } else await finish({ reason: 'success', retryable: false, healthScope: 'route' }, 'completed');
      } catch (error) {
        if (terminal) { if (cancelled) return; throw error; }
        const classification = classifyRouteError(error, input.signal?.aborted);
        try { await finish(classification, nativeStreamTermination(error, input.signal?.aborted)); }
        catch { /* The original wire failure wins over callback errors. */ }
        if (classification.reason !== 'cancelled') yield { bytes: nativeLateErrorBytes(error) };
      } finally { await close(); }
    })();
    const originalReturn = stream.return.bind(stream);
    stream.return = async value => { await cancel(); return originalReturn(value); };
    return stream;
  };
  return { prime, expose, finish, close, cancel, lifecycle, get terminal() { return terminal; } };
};
