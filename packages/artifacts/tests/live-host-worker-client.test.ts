import { describe, expect, it, vi } from 'vitest';
import {
  createLiveWorkerClient, LIVE_DRAFT_LIMITS, liveStoreDrafts, liveStoreFences, planLiveDraft, type LiveDraftSnapshot,
  type LiveWorkerClientOptions,
} from '../src/live-host/index.js';
import { createMemoryLiveStore, type LiveOverlayEntry } from '../src/server/live-store.js';
import { BASE, BASE_TREE, fakeBuilder, HEAD, id, keys, keysOf, LIVE_TREE, seededStore, SETS } from './fixtures/live-worker.js';

const binding = { artifactId: 'art-1', storageScopeId: 'scope-a', repoId: 'repo-immo', branch: 'artifact/p/alice/demo', subPath: '',
  state: 'attached', generation: 2 };
const bindings = { get: vi.fn(async () => binding as never) };
const identity = { authorization: async () => 'Bearer s2s' };
const sessionState = vi.fn(async () => ({ epoch: 2, expiresAt: null as number | null }));

const client = (store: ReturnType<typeof createMemoryLiveStore>, fetcher: unknown, over: Partial<LiveWorkerClientOptions> = {}) =>
  createLiveWorkerClient({ baseUrl: BASE, identity, fetch: fetcher as typeof fetch, bindings, sessionState,
    fences: liveStoreFences(store), drafts: liveStoreDrafts(store, keys), ...over });
const draftOf = (overlay: LiveOverlayEntry[]): LiveDraftSnapshot => ({ revision: 'rev-1', baseHeadSha: HEAD, liveTreeSha: LIVE_TREE, overlay });

describe('live-host worker client: draft staging before reconcile (host live API 07/11)', () => {
  it('stages the package draft (page, seal) then reconciles with the runtime ownerId, and the builder ACKs that revision', async () => {
    const overlay = [{ path: 'src/App.svelte', text: '<p>live</p>', mode: '100644' }, { path: 'bin/run', text: '', mode: '100755' },
      { path: 'old.txt', text: null, mode: '100644' }];
    const { store, record } = await seededStore(overlay);
    const builder = fakeBuilder();
    await expect(client(store, builder.fetcher).reconcile(id)).resolves.toEqual({ liveSessionId: 'sess-1', leaseEpoch: 4, routeEpoch: 3,
      revision: record.revision, ready: true });
    expect(builder.calls.map(c => c.path)).toEqual(['v1/live/draft/page', 'v1/live/draft/seal', 'v1/live/reconcile']);
    expect(builder.calls.every(c => c.authorization === 'Bearer s2s')).toBe(true);
    const [page, seal, reconcile] = builder.calls.map(c => c.body);
    expect(keysOf(page)).toEqual(SETS.page); expect(keysOf(seal)).toEqual(SETS.seal); expect(keysOf(reconcile)).toEqual(SETS.reconcile);
    expect(page).toMatchObject({ artifactId: 'art-1', bindingGeneration: 2, revision: record.revision, page: 0 });
    expect(seal).toEqual({ artifactId: 'art-1', bindingGeneration: 2, revision: record.revision, pages: 1, baseHeadSha: HEAD,
      treeSha: LIVE_TREE, deletes: ['old.txt'] });
    expect(builder.sealed()!.files.sort((a, b) => a.path.localeCompare(b.path))).toEqual([{ path: 'bin/run', mode: 0o755, text: '' },
      { path: 'src/App.svelte', mode: 0o644, text: '<p>live</p>' }]);
    expect(reconcile).toEqual({ artifactId: 'art-1', bindingGeneration: 2, ownerId: 'owner-alice', liveSessionId: 'sess-1', leaseEpoch: 4,
      routeEpoch: 3, binding: { repoId: 'repo-immo', branch: binding.branch, subPath: '' }, invitation: { epoch: 2, expiresAt: null } });
    expect(keysOf(reconcile.binding)).toEqual(['branch', 'repoId', 'subPath']);
  });

  it('stages a clean draft as pages 0 and no deletes with treeSha = the live tree, so the reconcile is not draft_not_staged', async () => {
    const { store, record } = await seededStore([]);
    const builder = fakeBuilder();
    await expect(client(store, builder.fetcher).reconcile(id)).resolves.toMatchObject({ revision: record.revision, ready: true });
    expect(builder.calls.map(c => c.path)).toEqual(['v1/live/draft/seal', 'v1/live/reconcile']);
    expect(builder.calls[0]!.body).toEqual({ artifactId: 'art-1', bindingGeneration: 2, revision: record.revision, pages: 0,
      baseHeadSha: HEAD, treeSha: BASE_TREE, deletes: [] });
  });

  it('re-stages the same revision on every reconcile (idempotent on the builder) and never lowers the session epoch', async () => {
    const { store } = await seededStore([{ path: 'a.txt', text: 'a', mode: '100644' }]);
    const builder = fakeBuilder(); const worker = client(store, builder.fetcher);
    await worker.reconcile(id);
    sessionState.mockImplementationOnce(async () => ({ epoch: 1, expiresAt: 5 }));
    await worker.reconcile(id);
    expect(builder.calls.map(c => c.path)).toEqual(['v1/live/draft/page', 'v1/live/draft/seal', 'v1/live/reconcile',
      'v1/live/draft/page', 'v1/live/draft/seal', 'v1/live/reconcile']);
    expect(builder.calls[5]!.body.invitation).toEqual({ epoch: 2, expiresAt: 5 });
  });

  it('pages within 1 MiB of file bytes, never an empty page, in order from page 0', () => {
    const big = 'x'.repeat(600 * 1024);
    const plan = planLiveDraft(draftOf([{ path: 'a', text: big, mode: '100644' }, { path: 'b', text: big, mode: '100644' },
      { path: 'c', text: 'small', mode: '100644' }, { path: 'gone', text: null, mode: '100644' }]), id);
    expect(plan.pages.map(p => [p.page, p.files.map(f => f.path)])).toEqual([[0, ['a']], [1, ['b', 'c']]]);
    for (const page of plan.pages) {
      expect(page.files.reduce((n, f) => n + Buffer.from(f.data, 'base64').byteLength, 0)).toBeLessThanOrEqual(LIVE_DRAFT_LIMITS.pageBytes);
    }
    expect(plan.seal).toMatchObject({ pages: 2, deletes: ['gone'] });
    const full = planLiveDraft(draftOf(Array.from({ length: 8 }, (_, i) => ({ path: `f${i}`, text: 'y'.repeat(1024 * 1024), mode: '100644' }))), id);
    expect(full.pages).toHaveLength(8);
    expect(planLiveDraft(draftOf([{ path: 'gone', text: null, mode: '100644' }]), id).pages).toEqual([]);
  });

  it('refuses an overlay over the draft limits, a duplicate path or a non-regular mode before any call', async () => {
    const mib = 'z'.repeat(1024 * 1024);
    const cases: Array<[LiveOverlayEntry[], string]> = [
      [[{ path: 'huge', text: `${mib}!`, mode: '100644' }], 'limit_exceeded'],
      [Array.from({ length: 9 }, (_, i) => ({ path: `f${i}`, text: mib, mode: '100644' })), 'limit_exceeded'],
      [Array.from({ length: 256 }, (_, i) => ({ path: `d${i}`, text: null, mode: '100644' })), 'limit_exceeded'],
      [[{ path: 'a', text: 'x', mode: '100644' }, { path: 'a', text: null, mode: '100644' }], 'provider_unavailable'],
      [[{ path: 'link', text: 'target', mode: '120000' }], 'provider_unavailable'],
    ];
    for (const [overlay, kind] of cases) {
      const builder = fakeBuilder();
      const worker = createLiveWorkerClient({ baseUrl: BASE, identity, fetch: builder.fetcher as never, bindings, sessionState,
        fences: { current: async () => ({ ownerId: 'o', liveSessionId: 's', leaseEpoch: 1, routeEpoch: 1 }) },
        drafts: { current: async () => draftOf(overlay) } });
      await expect(worker.reconcile(id)).rejects.toMatchObject({ kind });
      expect(builder.calls).toEqual([]);
    }
  });

  it('does not reconcile when a page or the seal is refused, and refuses a non-200 reconcile or a malformed ACK', async () => {
    const { store } = await seededStore([{ path: 'a.txt', text: 'a', mode: '100644' }]);
    for (const [route, paths] of [['page', ['v1/live/draft/page']], ['seal', ['v1/live/draft/page', 'v1/live/draft/seal']],
      ['reconcile', ['v1/live/draft/page', 'v1/live/draft/seal', 'v1/live/reconcile']]] as const) {
      const builder = fakeBuilder({ [route]: 503 });
      await expect(client(store, builder.fetcher).reconcile(id)).rejects.toMatchObject({ kind: 'provider_unavailable' });
      expect(builder.calls.map(c => c.path)).toEqual(paths);
    }
    const malformed = vi.fn(async (url: URL) => String(url).endsWith('/reconcile')
      ? new Response(JSON.stringify({ liveSessionId: 'sess-1', leaseEpoch: 4, routeEpoch: 3, revision: '', ready: true }), { status: 200 })
      : new Response(null, { status: 204 }));
    await expect(client(store, malformed).reconcile(id)).rejects.toMatchObject({ kind: 'provider_unavailable' });
    const reset = vi.fn(async () => { throw new Error('reset'); });
    await expect(client(store, reset).reconcile(id)).rejects.toMatchObject({ kind: 'provider_unavailable' });
  });

  it('fails closed before any call: no attached binding of that generation, no runtime, no draft, unconfigured', async () => {
    const { store } = await seededStore([]);
    for (const record of [undefined, { ...binding, state: 'detached' }, { ...binding, generation: 1 }, { ...binding, generation: 3 }]) {
      const builder = fakeBuilder();
      await expect(client(store, builder.fetcher, { bindings: { get: async () => record as never } }).reconcile(id))
        .rejects.toMatchObject({ kind: 'git_not_attached' });
      expect(builder.calls).toEqual([]);
    }
    const empty = createMemoryLiveStore(); const builder = fakeBuilder();
    await expect(client(empty, builder.fetcher).reconcile(id)).rejects.toMatchObject({ kind: 'provider_unavailable' });
    await expect(client(store, builder.fetcher, { drafts: { current: async () => undefined } }).reconcile(id))
      .rejects.toMatchObject({ kind: 'provider_unavailable' });
    expect(builder.calls).toEqual([]);
    const closed = createLiveWorkerClient({ fences: liveStoreFences(store), bindings, sessionState, drafts: liveStoreDrafts(store, keys) });
    await expect(closed.reconcile(id)).rejects.toMatchObject({ kind: 'builder_unavailable' });
    await expect(closed.stop({ ...id, liveSessionId: 's', leaseEpoch: 1 })).rejects.toMatchObject({ kind: 'builder_unavailable' });
    expect(() => client(store, builder.fetcher, { baseUrl: 'http://builder.test/v1' })).toThrow();
  });

  it('stops with the closed STOP body and requires 204', async () => {
    const { store } = await seededStore([]);
    const builder = fakeBuilder();
    await expect(client(store, builder.fetcher).stop({ ...id, liveSessionId: 'sess-1', leaseEpoch: 4 })).resolves.toBeUndefined();
    expect(builder.calls).toEqual([{ path: 'v1/live/stop', authorization: 'Bearer s2s',
      body: { artifactId: 'art-1', bindingGeneration: 2, liveSessionId: 'sess-1', leaseEpoch: 4 } }]);
    await expect(client(store, fakeBuilder({ stop: 200 }).fetcher).stop({ ...id, liveSessionId: 'sess-1', leaseEpoch: 4 }))
      .rejects.toMatchObject({ kind: 'provider_unavailable' });
  });

it('preserves a terminal builder failure on the ACK and ignores malformed shapes', async () => {
    const { store, record } = await seededStore([{ path: 'a.txt', text: 'a', mode: '100644' }]);
    const failure = { code: 'builder_unavailable', reason: 'phase_timeout:install:drain' };
    const fetcher = vi.fn(async (url: URL) => String(url).endsWith('/reconcile')
      ? new Response(JSON.stringify({ liveSessionId: 'sess-1', leaseEpoch: 4, routeEpoch: 3,
        revision: record.revision, ready: false, failure }), { status: 200 })
      : new Response(null, { status: 204 }));
    await expect(client(store, fetcher).reconcile(id)).resolves.toEqual({ liveSessionId: 'sess-1', leaseEpoch: 4,
      routeEpoch: 3, revision: record.revision, ready: false, failure });
    const malformed = vi.fn(async (url: URL) => String(url).endsWith('/reconcile')
      ? new Response(JSON.stringify({ liveSessionId: 'sess-1', leaseEpoch: 4, routeEpoch: 3,
        revision: record.revision, ready: false, failure: { code: '', reason: 7 } }), { status: 200 })
      : new Response(null, { status: 204 }));
    await expect(client(store, malformed).reconcile(id)).resolves.toEqual({ liveSessionId: 'sess-1', leaseEpoch: 4,
      routeEpoch: 3, revision: record.revision, ready: false });
  });

  it('maps a 409 cache_not_prewarmed refusal to a typed retriable error instead of provider_unavailable', async () => {
    const { store } = await seededStore([]);
    const fetcher = vi.fn(async (url: URL) => {
      const path = String(url).slice(BASE.length + 1);
      if (path === 'v1/live/reconcile') {
        return new Response(JSON.stringify({ error: 'cache_not_prewarmed', reason: 'a'.repeat(64),
          lockSha256: 'a'.repeat(64), retriable: true }), { status: 409 });
      }
      return new Response(null, { status: 204 });
    });
    const failure = await client(store, fetcher).reconcile(id).then(() => undefined, error => error);
    expect(failure).toMatchObject({ kind: 'cache_not_prewarmed', name: 'ArtifactOperationError' });
    expect(failure.details).toMatchObject({
      refusal: { allowed: false, reason: 'unavailable', status: 409, publicCode: 'cache_not_prewarmed', retriable: true },
      publicDetails: { lockSha256: 'a'.repeat(64) },
    });
    const opaque = vi.fn(async () => new Response(JSON.stringify({ error: 'cache_not_prewarmed' }), { status: 500 }));
    await expect(client(store, opaque).reconcile(id)).rejects.toMatchObject({ kind: 'provider_unavailable' });
  });
});
