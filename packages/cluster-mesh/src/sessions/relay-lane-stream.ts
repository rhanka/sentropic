// INTERNAL stream iterator implementing the frozen L-6 iterator discipline
// (RC2.contract r3 runtimeComposition.stream/.termination): cold open on first
// next(), single consumer, buffered queue ≤ 8 events / ≤ 131072 encoded bytes
// then one relay_backpressure and done, exactly one typed error then done,
// mid-event EOF → relay_protocol_refused (never a partial record), incompatible
// route → relay_lane_refused, return() cancels only this request, abort while
// next() waits → one relay_unavailable then done. Not packed; minted only by
// the lane client engine (relay-lane-client).
import { relayError } from './registry-types.js';
import type { RelayError } from './registry-types.js';
import { jcsCanonicalize } from './relay-wire.js';
import { RELAY_LINK_MAX_FRAMES, RELAY_LINK_MAX_PAYLOAD_BYTES } from './relay-credit.js';
import { correlate } from './relay-lane-record.js';
import type { LaneStreamSourceV1 } from './relay-lane-record.js';
import type { SessionRelayLaneResponseV1 } from './relay-types.js';

export interface LaneStreamHooksV1 {
  readonly isClosed: () => boolean;
  readonly onClose: (listener: () => void) => void;
}

const DONE: IteratorResult<SessionRelayLaneResponseV1> = { done: true, value: undefined };

export function createLaneStreamIterator(
  routeId: string,
  start: () => Promise<{ source: LaneStreamSourceV1 } | { error: RelayError }>,
  signal: AbortSignal | undefined,
  hooks: LaneStreamHooksV1,
): AsyncIterableIterator<SessionRelayLaneResponseV1> {
  let source: LaneStreamSourceV1 | null = null;
  let opened = false;
  let finished = false;
  let overflow = false;
  let eof = false;
  let partialEof = false;
  let queue: SessionRelayLaneResponseV1[] = [];
  let queuedBytes = 0;
  let interrupt: (() => void) | null = null;
  let tail: Promise<unknown> = Promise.resolve();

  const onAbortOrClose = () => {
    interrupt?.();
  };
  signal?.addEventListener('abort', onAbortOrClose, { once: true });
  hooks.onClose(onAbortOrClose);

  const finish = () => {
    finished = true;
    interrupt?.();
    source?.cancel();
    source = null;
    signal?.removeEventListener('abort', onAbortOrClose);
  };

  // One terminal typed error, then done on the following next().
  const terminal = (error: RelayError): IteratorResult<SessionRelayLaneResponseV1> => {
    finish();
    return { done: false, value: { routeId, error } };
  };

  const pull = (): Promise<{ done: boolean; record?: unknown; partial?: boolean; interrupted?: boolean }> => {
    const current = source as LaneStreamSourceV1;
    const interrupted = new Promise<{ done: true; interrupted: true }>((resolve) => {
      interrupt = () => resolve({ done: true, interrupted: true });
    });
    return Promise.race([current.next(), interrupted]).finally(() => {
      interrupt = null;
    });
  };

  const cancelSource = () => {
    const s = source;
    source = null;
    s?.cancel();
  };

  const step = async (): Promise<IteratorResult<SessionRelayLaneResponseV1>> => {
    if (finished) return DONE;
    if (queue.length > 0) return { done: false, value: queue.shift() as SessionRelayLaneResponseV1 };
    if (!opened) {
      opened = true;
      let started: { source: LaneStreamSourceV1 } | { error: RelayError };
      try {
        started = await start();
      } catch {
        return terminal(relayError('relay_unavailable', true));
      }
      if (finished) return DONE;
      if ('error' in started) return terminal(started.error);
      source = started.source;
    }
    if (signal?.aborted || hooks.isClosed()) return terminal(relayError('relay_unavailable', true));
    while (!overflow && !eof && !partialEof && queue.length < RELAY_LINK_MAX_FRAMES) {
      const rec = await pull();
      if (finished) return DONE;
      if (rec.interrupted || signal?.aborted || hooks.isClosed()) return terminal(relayError('relay_unavailable', true));
      if (rec.partial) {
        partialEof = true; // mid-event EOF: complete events drain first, never a partial record
        break;
      }
      if (rec.done) {
        eof = true;
        break;
      }
      const bytes = 4 + jcsCanonicalize(rec.record).length;
      if (queuedBytes + bytes > RELAY_LINK_MAX_PAYLOAD_BYTES) {
        overflow = true;
        cancelSource();
        break;
      }
      const correlated = correlate(routeId, rec.record);
      if ('error' in correlated) return terminal(correlated.error);
      queue.push(correlated.response);
      queuedBytes += bytes;
    }
    // Buffer full and the source still has events → backpressure after drain.
    if (!overflow && !eof && !partialEof && queue.length >= RELAY_LINK_MAX_FRAMES) {
      const rec = await pull();
      if (finished) return DONE;
      if (rec.interrupted || signal?.aborted || hooks.isClosed()) return terminal(relayError('relay_unavailable', true));
      if (rec.partial) partialEof = true;
      else if (rec.done) eof = true;
      else {
        overflow = true;
        cancelSource();
      }
    }
    if (queue.length > 0) return { done: false, value: queue.shift() as SessionRelayLaneResponseV1 };
    if (partialEof) return terminal(relayError('relay_protocol_refused'));
    if (overflow) return terminal(relayError('relay_backpressure', true));
    if (eof) {
      finish();
      return DONE;
    }
    return terminal(relayError('relay_protocol_refused'));
  };

  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    next(): Promise<IteratorResult<SessionRelayLaneResponseV1>> {
      // Single consumer: concurrent next() calls are serialized in call order.
      const result = tail.then(step, step);
      tail = result.catch(() => undefined);
      return result;
    },
    return(): Promise<IteratorResult<SessionRelayLaneResponseV1>> {
      finish();
      return Promise.resolve(DONE);
    },
  };
}
