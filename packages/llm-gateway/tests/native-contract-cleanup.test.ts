import { describe, expect, it, vi } from 'vitest';
import { nativeHarness } from './fixtures/native-flow.js';
import { runRouteJsonFlow } from '../src/route-json-flow.js';
import { runRouteStreamFlow } from '../src/route-stream-flow.js';

describe('malformed native response reader cleanup', () => {
  it.each(['json', 'stream'] as const)('closes a returned reader once before exposing a %s contract refusal', async flow => {
    const next = vi.fn(async () => ({ done: true as const, value: undefined }));
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    const h = nativeHarness({ execute: async () => ({ kind: 'stream', status: flow === 'json' ? 200 : 201,
      headers: {}, body: { [Symbol.asyncIterator]: () => ({ next, return: close }) } }) as never });
    const run = flow === 'json' ? runRouteJsonFlow : runRouteStreamFlow;
    await expect(run(h.deps, { ...h.request, stream: flow === 'stream' })).rejects.toMatchObject({ code: 'native_protocol_error' });
    expect(next).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(h.finalize).toHaveBeenCalledTimes(1);
    expect(h.recorder.settlements).toHaveLength(1);
    expect(h.snapshots[0]).toMatchObject({ termination: 'protocol_error', estimated: true });
  });
});
