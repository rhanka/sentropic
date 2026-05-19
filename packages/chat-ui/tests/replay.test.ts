/**
 * BR14a Lot 2 — @sentropic/chat-ui replay contract tests.
 *
 * Verifies the cursor shape, the `replayFromSeq` async iterable
 * contract, and the close-on-error path through a fake EventSource.
 */
import { describe, expect, it } from 'vitest';

import {
  createReplayClient,
  type ReplayClient,
  type ReplayCursor,
} from '../src/client/replay.js';
import type { ChatCoreTransport } from '../src/client/transport.js';

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly closed: { value: boolean } = { value: false };
  close(): void {
    this.closed.value = true;
  }
}

const buildTransport = (
  source: FakeEventSource,
): { transport: ChatCoreTransport; lastFromSeq: { value?: number } } => {
  const lastFromSeq: { value?: number } = {};
  return {
    lastFromSeq,
    transport: {
      openStream(_sessionId, fromSeq) {
        lastFromSeq.value = fromSeq;
        return source as unknown as EventSource;
      },
      async postMessage() {
        return new Response();
      },
      async fetchBootstrap() {
        return {};
      },
    },
  };
};

describe('createReplayClient', () => {
  it('returns an object exposing the ReplayClient.replayFromSeq method', () => {
    const { transport } = buildTransport(new FakeEventSource());
    const client: ReplayClient = createReplayClient(transport);
    expect(typeof client.replayFromSeq).toBe('function');
  });

  it('cursor shape carries sessionId + fromSeq and is forwarded to transport.openStream', async () => {
    const source = new FakeEventSource();
    const { transport, lastFromSeq } = buildTransport(source);
    const client = createReplayClient(transport);
    const cursor: ReplayCursor = { sessionId: 'session-1', fromSeq: 7 };
    const iterable = client.replayFromSeq(cursor);
    expect(iterable[Symbol.asyncIterator]).toBeDefined();
    // Trigger close so the iterator terminates and the test exits cleanly.
    source.onerror?.(new Event('error'));
    const iterator = iterable[Symbol.asyncIterator]();
    const result = await iterator.next();
    expect(result.done).toBe(true);
    expect(lastFromSeq.value).toBe(7);
  });

  it('yields raw MessageEvent.data payloads through the async iterable', async () => {
    const source = new FakeEventSource();
    const { transport } = buildTransport(source);
    const client = createReplayClient(transport);
    const iterable = client.replayFromSeq({ sessionId: 's', fromSeq: 0 });
    const iterator = iterable[Symbol.asyncIterator]();
    source.onmessage?.({ data: 'first' } as MessageEvent);
    source.onmessage?.({ data: 'second' } as MessageEvent);
    const first = await iterator.next();
    const second = await iterator.next();
    expect(first).toEqual({ value: 'first', done: false });
    expect(second).toEqual({ value: 'second', done: false });
    source.onerror?.(new Event('error'));
  });

  it('closes the underlying EventSource when the consumer returns early', async () => {
    const source = new FakeEventSource();
    const { transport } = buildTransport(source);
    const client = createReplayClient(transport);
    const iterable = client.replayFromSeq({ sessionId: 's', fromSeq: 0 });
    const iterator = iterable[Symbol.asyncIterator]();
    const ret = await iterator.return?.();
    expect(ret).toEqual({ value: undefined, done: true });
    expect(source.closed.value).toBe(true);
  });
});
