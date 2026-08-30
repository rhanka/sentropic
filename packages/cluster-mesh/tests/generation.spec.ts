import { describe, expect, it, vi } from 'vitest';
import { idempotencyKey } from '../../contracts/src/index.js';
import { createClusterMeshRuntime } from '../src/runtime/generation.js';

describe('cluster mesh generation runtime', () => {
  it('should bind admission and receipts to one active generation', async () => {
    const append = vi.fn(async () => undefined);
    const runtime = createClusterMeshRuntime({
      generationId: 'generation-1',
      config: { capacity: { poolSize: 3 } },
      context: {
        async verify() {
          throw new Error('not invoked');
        },
      },
      registration: {
        async authorize() {
          return { ok: false, reason: 'missing_registration' };
        },
      },
      receipts: { append },
      now: () => new Date('2026-08-30T12:00:00.000Z'),
    });

    expect(runtime.generation).toMatchObject({
      generationId: 'generation-1',
      status: 'active',
      config: { capacity: { maxConcurrent: 12, poolSize: 3 } },
    });
    expect(runtime.admission.maxConcurrent).toBe(12);

    await runtime.receipts.transported({
      invocationId: 'invocation-1',
      correlationId: 'correlation-1',
      idempotencyKey: idempotencyKey('idempotency-1'),
    });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'transported',
      generationId: 'generation-1',
    }));
  });
});
