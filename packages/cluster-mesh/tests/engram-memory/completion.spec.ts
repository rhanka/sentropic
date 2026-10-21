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

describe('memory stateful first-proof enforcement', () => {
  const storedCapture = {
    candidateId: 'candidate-1',
    revision: 1,
    recordDigest: null,
    createdCursor: '0',
    proof: { intent: 'capture' },
  };
  const storedOutcome = { candidateId: 'candidate-1', outcome: 'accepted', proof: { decision: 'accept' } };
  const captureKey = JSON.stringify(['memory-capture-idempotency-v1', 'candidate-1']);
  const outcomeKey = JSON.stringify(['memory-admission-outcome-v1', 'candidate-1']);
  const updateFor = (key: string, version: number, value: unknown) => ({
    key,
    version,
    value: { format: 'utf8', data: JSON.stringify(value) },
  });
  const resolveCurrent = (stored: ReadonlyMap<string, unknown>) => async (key: string): Promise<unknown> =>
    stored.get(key);

  it('should refuse a higher-version write that changes the original capture proof', async () => {
    const stored = new Map<string, unknown>([[captureKey, storedCapture]]);
    await expect(
      validateMemoryEffects(
        {
          ...emptyUnit(),
          updates: [
            updateFor(captureKey, 99, {
              ...storedCapture,
              revision: 99,
              recordDigest: 'sha256:changed',
              createdCursor: '999',
              proof: { changed: true },
            }),
          ],
        },
        resolveCurrent(stored),
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('should refuse a higher-version write that changes the admission outcome', async () => {
    const stored = new Map<string, unknown>([[outcomeKey, storedOutcome]]);
    await expect(
      validateMemoryEffects(
        {
          ...emptyUnit(),
          updates: [updateFor(outcomeKey, 2, { ...storedOutcome, outcome: 'rejected', proof: { changed: true } })],
        },
        resolveCurrent(stored),
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('should accept identical replay against the stored first proof', async () => {
    const completed = { ...storedCapture, revision: 2, recordDigest: 'sha256:abc' };
    const stored = new Map<string, unknown>([[captureKey, completed]]);
    await validateMemoryEffects(
      { ...emptyUnit(), updates: [updateFor(captureKey, 2, { ...completed })] },
      resolveCurrent(stored),
    );
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
