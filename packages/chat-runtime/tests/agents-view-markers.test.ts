import { describe, expect, it } from 'vitest';
import {
  buildAgentsViewMarkersKey,
  createAgentsViewMarkers,
} from '../src/state/agentsViewMarkers.js';
import type { AgentsEntry } from '../src/state/agentsEntry.js';

/** Async storage stub — mirrors the chrome.storage shape the port must tolerate. */
const asyncStore = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return {
    data,
    adapter: {
      get: (key: string) => Promise.resolve(data[key] ?? null),
      set: (key: string, value: string) => {
        data[key] = value;
        return Promise.resolve();
      },
    },
  };
};

const entry = (id: string, lastViewedAt?: number): AgentsEntry => ({
  id,
  kind: 'session',
  title: id,
  status: 'idle',
  lastActivityAt: 1,
  ...(lastViewedAt === undefined ? {} : { lastViewedAt }),
});

describe('agents view markers — key namespacing', () => {
  it('separates two principals in the same browser', () => {
    const a = buildAgentsViewMarkersKey({ principalId: 'alice', workspaceId: 'w1' });
    const b = buildAgentsViewMarkersKey({ principalId: 'bob', workspaceId: 'w1' });
    expect(a).not.toBe(b);
  });

  it('separates workspaces for the same principal', () => {
    expect(buildAgentsViewMarkersKey({ principalId: 'alice', workspaceId: 'w1' })).not.toBe(
      buildAgentsViewMarkersKey({ principalId: 'alice', workspaceId: 'w2' }),
    );
  });
});

describe('agents view markers — persistence over an ASYNC adapter', () => {
  it('round-trips a marker through a promise-returning storage', async () => {
    const store = asyncStore();
    const markers = createAgentsViewMarkers({ storage: store.adapter });
    await markers.markViewed('s1', 1_700);
    expect(await markers.read()).toEqual({ s1: 1_700 });
  });

  it('never moves a marker backwards', async () => {
    const store = asyncStore();
    const markers = createAgentsViewMarkers({ storage: store.adapter });
    await markers.markViewed('s1', 2_000);
    await markers.markViewed('s1', 500);
    expect((await markers.read()).s1).toBe(2_000);
  });

  it('caps retained markers, dropping the oldest first', async () => {
    const store = asyncStore();
    const markers = createAgentsViewMarkers({ storage: store.adapter, maxEntries: 2 });
    await markers.markViewed('old', 1);
    await markers.markViewed('mid', 2);
    await markers.markViewed('new', 3);
    expect(Object.keys(await markers.read()).sort()).toEqual(['mid', 'new']);
  });

  it('returns an empty map when no storage is wired at all', async () => {
    expect(await createAgentsViewMarkers().read()).toEqual({});
  });
});

describe('agents view markers — corrupt or hostile stores', () => {
  it('ignores unparseable JSON instead of throwing', async () => {
    const store = asyncStore();
    const key = buildAgentsViewMarkersKey({});
    store.data[key] = '{not json';
    expect(await createAgentsViewMarkers({ storage: store.adapter }).read()).toEqual({});
  });

  it('drops non-numeric and non-positive timestamps', async () => {
    const store = asyncStore();
    const key = buildAgentsViewMarkersKey({});
    store.data[key] = JSON.stringify({ ok: 5, nope: 'yesterday', zero: 0, neg: -3 });
    expect(await createAgentsViewMarkers({ storage: store.adapter }).read()).toEqual({ ok: 5 });
  });

  it('survives a storage that rejects writes', async () => {
    const markers = createAgentsViewMarkers({
      storage: {
        get: () => Promise.resolve(null),
        set: () => Promise.reject(new Error('quota exceeded')),
      },
    });
    await expect(markers.markViewed('s1', 10)).resolves.toBeUndefined();
  });
});

describe('agents view markers — apply', () => {
  it('fills lastViewedAt from the stored marker', async () => {
    const store = asyncStore();
    const markers = createAgentsViewMarkers({ storage: store.adapter });
    await markers.markViewed('s1', 900);
    const [applied] = await markers.apply([entry('s1')]);
    expect(applied?.lastViewedAt).toBe(900);
  });

  it('keeps the most recent of the local marker and a server-provided value', async () => {
    const store = asyncStore();
    const markers = createAgentsViewMarkers({ storage: store.adapter });
    await markers.markViewed('s1', 100);
    const [localOlder] = await markers.apply([entry('s1', 900)]);
    expect(localOlder?.lastViewedAt).toBe(900);
    await markers.markViewed('s2', 900);
    const [localNewer] = await markers.apply([entry('s2', 100)]);
    expect(localNewer?.lastViewedAt).toBe(900);
  });

  it('leaves an unmarked entry untouched rather than inventing a timestamp', async () => {
    const [applied] = await createAgentsViewMarkers().apply([entry('s1')]);
    expect(applied?.lastViewedAt).toBeUndefined();
  });
});
