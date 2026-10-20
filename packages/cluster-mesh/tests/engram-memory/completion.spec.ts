// G1c completion and P3 replay: K7 revision advance, zero-append capture
// units and single-event commit identity reuse versus conflict.

import { describe, expect, it } from 'vitest';
import { classifyCommitReplay, validateCommitReplay } from '../../src/engram-memory/replay-policy.js';
import { validateMemoryEffects } from '../../src/engram-memory/postgres.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';

const emptyUnit = (): AtomicUnit =>
  ({
    guards: [],
    records: [],
    appends: [],
    updates: [],
    relationships: [],
    barriers: [],
    purgeIntents: [],
    indexWrites: [],
  }) as AtomicUnit;

describe('memory capture completion', () => {
  it('should accept a zero-append completion unit carrying a filled proof', async () => {
    await validateMemoryEffects({
      ...emptyUnit(),
      updates: [
        {
          key: JSON.stringify(['memory-capture-idempotency-v1', 'candidate-1']),
          version: 2,
          value: {
            format: 'utf8',
            data: JSON.stringify({
              candidateId: 'candidate-1',
              revision: 2,
              recordDigest: 'sha256:abc',
              createdCursor: '0',
              proof: {},
            }),
          },
        },
      ],
    });
  });

  it('should refuse base64-encoded malformed proofs without leaking bytes', async () => {
    await expect(
      validateMemoryEffects({
        ...emptyUnit(),
        updates: [
          {
            key: JSON.stringify(['memory-capture-idempotency-v1', 'candidate-1']),
            version: 2,
            value: { format: 'base64', data: Buffer.from('not-json').toString('base64') },
          },
        ],
      }),
    ).rejects.toThrow();
  });
});

describe('memory P3 commit identity', () => {
  it('should proceed on unknown events, reuse same intents and conflict on divergence', () => {
    expect(classifyCommitReplay({}, { eventId: 'e1', intentHash: 'h1' })).toEqual({ kind: 'proceed' });
    expect(classifyCommitReplay({ e1: 'h1' }, { eventId: 'e1', intentHash: 'h1' })).toEqual({
      kind: 'reuse',
      eventId: 'e1',
    });
    expect(classifyCommitReplay({ e1: 'h1' }, { eventId: 'e1', intentHash: 'h2' })).toEqual({
      kind: 'conflict',
      eventId: 'e1',
    });
  });

  it('should refuse conflicting intents before effects without overwriting', () => {
    expect(validateCommitReplay({ e1: 'h1' }, { eventId: 'e1', intentHash: 'h1' }).ok).toBe(true);
    expect(validateCommitReplay({}, { eventId: 'e1', intentHash: 'h1' }).ok).toBe(true);
    expect(validateCommitReplay({ e1: 'h1' }, { eventId: 'e1', intentHash: 'h2' }).ok).toBe(false);
    expect(() => classifyCommitReplay({}, { eventId: '', intentHash: 'h1' })).toThrow();
  });
});
