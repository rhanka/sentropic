import { describe, expect, it } from 'vitest';
import { normalizeSpeechUsage, priceSpeechUsage, validateSpeechUsage } from '../src/speech/usage.js';
import { price } from './fixtures/speech-ledger.js';

describe('speech native usage units', () => {
  it('should price duration, characters and tokens without fabricating missing dimensions', () => {
    const p = { ...price(), fixedMicroUsd: 7, rates: {
      admittedAudioSeconds: { microUsd: 60_000, per: 60 }, connectedSeconds: { microUsd: 1, per: 1 },
      ttsCharacters: { microUsd: 1000, per: 1000 }, inputTokens: { microUsd: 10, per: 100 },
      outputTokens: { microUsd: 20, per: 100 }, cacheTokens: { microUsd: 1, per: 100 },
      audioInputTokens: { microUsd: 100, per: 100 }, audioOutputTokens: { microUsd: 200, per: 100 },
      audioCacheTokens: { microUsd: 5, per: 100 },
    } };
    expect(priceSpeechUsage(p, { admittedAudioSeconds: 1.5, connectedSeconds: 10, ttsCharacters: 10,
      inputTokens: 100, outputTokens: 100, cacheTokens: 100, audioInputTokens: 100,
      audioOutputTokens: 100, audioCacheTokens: 100, capturedAudioSeconds: 20, localComputeMs: 40 })).toBe(1863);
    const state = normalizeSpeechUsage(undefined, { eventId: 'e', revision: 0, mode: 'cumulative',
      usage: { admittedAudioSeconds: 1.5 } });
    expect(state.totals).toEqual({ admittedAudioSeconds: 1.5 });
    expect(state.totals.inputTokens).toBeUndefined();
  });

  it('should round each billable amount up to one micro-dollar', () => {
    expect(priceSpeechUsage({ ...price(), rates: { connectedSeconds: { microUsd: 1, per: 60 } } },
      { connectedSeconds: 0.000001 })).toBe(1);
  });

  it('should refuse malformed dimensions and unpriced units', () => {
    for (const usage of [{ inputTokens: -1 }, { audioInputTokens: 1.5 }, { connectedSeconds: Infinity },
      { ttsCharacters: NaN }, { connectedSeconds: Number.MAX_SAFE_INTEGER }, { transcript: 'sensitive' }]) {
      expect(() => validateSpeechUsage(usage as never)).toThrow();
    }
    expect(() => priceSpeechUsage(price(), { ttsCharacters: 1 })).toThrow('pinned price');
    expect(() => priceSpeechUsage({ ...price(), currency: 'EUR' as 'USD' }, {})).toThrow();
    expect(() => priceSpeechUsage({ ...price(), rates: { connectedSeconds: { microUsd: -1, per: 1 } } }, {})).toThrow();
    expect(() => priceSpeechUsage({ ...price(), rates: { localComputeMs: { microUsd: 1, per: 1 } } }, {})).toThrow();
  });

  it('should replace cumulative snapshots and ignore old or duplicate revisions after restart', () => {
    const first = normalizeSpeechUsage(undefined, { eventId: 'e1', revision: 1, mode: 'cumulative',
      usage: { audioInputTokens: 30 } });
    const latest = normalizeSpeechUsage(first, { eventId: 'e2', revision: 2, mode: 'cumulative',
      usage: { audioInputTokens: 50 } });
    expect(latest.totals.audioInputTokens).toBe(50);
    expect(normalizeSpeechUsage(JSON.parse(JSON.stringify(latest)), { eventId: 'e1', revision: 1,
      mode: 'cumulative', usage: { audioInputTokens: 30 } })).toEqual(latest);
    expect(() => normalizeSpeechUsage(latest, { eventId: 'other', revision: 2, mode: 'cumulative',
      usage: { audioInputTokens: 80 } })).toThrow('revision conflict');
  });

  it('should count incremental events once and apply a revised event as a delta', () => {
    const one = { eventId: 'e1', revision: 1, mode: 'incremental' as const, usage: { ttsCharacters: 10 } };
    const first = normalizeSpeechUsage(undefined, one);
    expect(normalizeSpeechUsage(first, one)).toEqual(first);
    const second = normalizeSpeechUsage(first, { ...one, eventId: 'e2', usage: { ttsCharacters: 20 } });
    expect(normalizeSpeechUsage(second, { ...one, revision: 2, usage: { ttsCharacters: 5 } }).totals).toEqual({ ttsCharacters: 25 });
    expect(() => normalizeSpeechUsage(first, { ...one, usage: { ttsCharacters: 11 } })).toThrow('revision conflict');
    expect(() => normalizeSpeechUsage(first, { ...one, mode: 'cumulative' })).toThrow();
  });

  it('should reconcile revised text token events without mutating the previous snapshot', () => {
    const event = { eventId: 'tokens', revision: 0, mode: 'incremental' as const,
      usage: { inputTokens: 10, outputTokens: 5 } };
    const first = normalizeSpeechUsage(undefined, event);
    const next = normalizeSpeechUsage(first, { ...event, revision: 1,
      usage: { inputTokens: 12, outputTokens: 3 } });
    expect(next.totals).toEqual({ inputTokens: 12, outputTokens: 3 });
    expect(first.totals).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(normalizeSpeechUsage(next, event)).toEqual(next);
  });

  it('should treat prototype-shaped event IDs as ordinary deduplicated provider IDs', () => {
    for (const eventId of ['constructor', '__proto__', 'toString']) {
      const event = { eventId, revision: 0, mode: 'incremental' as const, usage: { ttsCharacters: 3 } };
      const state = normalizeSpeechUsage(undefined, event);
      expect(normalizeSpeechUsage(JSON.parse(JSON.stringify(state)), event).totals.ttsCharacters).toBe(3);
    }
  });
});
