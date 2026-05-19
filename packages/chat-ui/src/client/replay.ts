/**
 * BR14a Lot 2 — @sentropic/chat-ui replay client interface.
 *
 * Cursor-based replay shape so consumers can re-subscribe to a chat
 * session stream from a known sequence number after a navigation,
 * reconnect, or page refresh. Lot 2 ships an interface-first contract;
 * full BR-14b `GET /sessions/:id/events?fromSeq=N` semantics land later.
 */

import type { ChatCoreTransport } from './transport.js';

export interface ReplayCursor {
  sessionId: string;
  fromSeq: number;
}

export interface ReplayClient {
  /**
   * Yield raw stream events from the given cursor. The default
   * implementation maps `MessageEvent.data` directly so consumers can
   * decode JSON or keep raw text per their projection layer.
   */
  replayFromSeq(cursor: ReplayCursor): AsyncIterable<unknown>;
}

export const createReplayClient = (transport: ChatCoreTransport): ReplayClient => ({
  replayFromSeq(cursor) {
    const source = transport.openStream(cursor.sessionId, cursor.fromSeq);
    const queue: unknown[] = [];
    const waiters: Array<(value: IteratorResult<unknown>) => void> = [];
    let closed = false;

    const push = (value: unknown): void => {
      const waiter = waiters.shift();
      if (waiter) {
        waiter({ value, done: false });
        return;
      }
      queue.push(value);
    };

    source.onmessage = (event) => push((event as MessageEvent).data);
    source.onerror = () => {
      closed = true;
      source.close();
      while (waiters.length > 0) {
        waiters.shift()?.({ value: undefined, done: true });
      }
    };

    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<unknown>> {
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift(), done: false });
            }
            if (closed) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise((resolve) => waiters.push(resolve));
          },
          return(): Promise<IteratorResult<unknown>> {
            closed = true;
            source.close();
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  },
});
