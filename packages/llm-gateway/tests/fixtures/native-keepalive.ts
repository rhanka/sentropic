/** N30 fixture: gated upstream + execution setup for keepalive tests. */
import { vi } from 'vitest';

import type { PreparedRouteAttempt } from '@sentropic/llm-mesh';
import { nativeStreamExecution } from '../../src/route-native-stream.js';
import {
  NativeUsageObserver, NATIVE_SSE_KEEPALIVE,
  type RouteAttemptSettlement,
} from '../../src/index.js';

export const frame = (event: string, data: string) =>
  new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`);
export const START = frame('message_start', '{"type":"message_start"}');
export const STOP = frame('message_stop', '{"type":"message_stop"}');
export const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
export const KEEPALIVE = new TextEncoder().encode(NATIVE_SSE_KEEPALIVE);

const deferred = () => {
  let resolve!: (chunk: Uint8Array) => void;
  const promise = new Promise<Uint8Array>(done => { resolve = done; });
  return { promise, resolve };
};

/** Upstream source the test drives chunk by chunk; each pull creates its gate. */
export const upstreamSource = (chunks: Uint8Array[]) => {
  const gates: Array<ReturnType<typeof deferred>> = [];
  const iterator = (async function* () {
    for (const chunk of chunks) {
      const gate = deferred();
      gates.push(gate);
      await gate.promise;
      yield chunk;
    }
  })();
  return { iterator, gates };
};

export const setup = () => {
  const attempt = {
    attemptRef: 'attempt-1',
    complete: vi.fn(async () => undefined),
    releaseCancelled: vi.fn(async () => undefined),
    recordOutcome: vi.fn(async () => undefined),
  };
  const attempts: RouteAttemptSettlement[] = [];
  const settle = vi.fn(async () => undefined);
  const controller = new AbortController();
  const execution = nativeStreamExecution({
    attempt: attempt as unknown as PreparedRouteAttempt,
    observer: new NativeUsageObserver('m'),
    controller,
    signal: controller.signal,
    target: { providerId: 'anthropic', model: 'm', transportProviderId: 't' },
    candidateRef: 'candidate-1',
    attempts,
    requestId: 'request-1',
    features: { requestSafeguards: false, sentBetas: [] },
    settle,
  });
  return { execution, attempt, attempts, settle, controller };
};
