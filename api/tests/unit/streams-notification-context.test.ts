import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const connection = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('../../src/db/client', () => ({ pool: connection }));
import { productStreamsNotificationsPort } from '../../src/routes/namespaces/streams-product-notifications';

describe('pooled PostgreSQL notification context', () => {
  it('runs an SSE callback in its subscriber context after the emitting transaction has ended', async () => {
    const scope = new AsyncLocalStorage<string>();
    const client = Object.assign(new EventEmitter(), { query: vi.fn(), release: vi.fn() });
    connection.connect.mockResolvedValue(client);
    const observed: Array<string | undefined> = [];
    const unsubscribe = await scope.run('sse-subscriber', () => productStreamsNotificationsPort.subscribe({
      channels: ['lock_events', 'presence_events'],
      onNotification: () => { observed.push(scope.getStore()); },
    }));
    try {
      scope.run('expired-identity-transaction', () => {
        client.emit('notification', { channel: 'lock_events', payload: '{}' });
        client.emit('notification', { channel: 'presence_events', payload: '{}' });
      });
      expect(observed).toEqual(['sse-subscriber', 'sse-subscriber']);
    } finally { await unsubscribe(); }
    expect(client.listenerCount('notification')).toBe(0);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
