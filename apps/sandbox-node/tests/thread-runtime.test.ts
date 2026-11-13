import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ThreadRuntimeAdapter } from '../src/thread-runtime.js';

const workers = vi.hoisted(() => [] as any[]);
vi.mock('node:worker_threads', () => ({ Worker: class extends EventEmitter {
  data: any; messages: any[] = [];
  constructor(_url: unknown, options: any) { super(); this.data = options.workerData; workers.push(this); }
  unref() {}
  terminate() { this.emit('exit', 1); return Promise.resolve(1); }
  postMessage(message: any) {
    this.messages.push(message);
    if (message.method !== 'runSandbox') queueMicrotask(() => this.emit('message', { id: message.id, result: true }));
  }
} }));

describe('runtime thread failure reconciliation', () => {
  it.each([false, true])('should retain launch identity outside the worker and stop scopes after death (during launch=%s)', async launching => {
    const adapter = new ThreadRuntimeAdapter('runsc');
    const first = workers.at(-1);
    const options = { tenantId: 'immo', sandboxUid: 'physical', overlayUpper: '/private/upper' };
    const pending = adapter.runSandbox(options as never);
    const observed = pending.catch(error => error);
    if (!launching) first.emit('message', { id: first.messages[0].id, result: { runtimeId: 'runsc-immo-physical' } });
    first.emit('exit', 1);
    await observed;
    const recovery = workers.at(-1);
    expect(adapter.healthy).toBe(false);
    expect(recovery).not.toBe(first);
    expect(recovery.data.recovery).toEqual([options]);
    expect(recovery.messages).toContainEqual(expect.objectContaining({ method: 'stopSandbox', args: ['runsc-immo-physical'] }));
    await adapter.destroySandbox('runsc-immo-physical');
    expect(recovery.messages.at(-1).method).toBe('destroySandbox');
    await adapter.close();
  });
});
