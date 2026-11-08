import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiveWorkerClient, type LiveDraftSnapshot, type LiveWorkerClientOptions } from '../src/live-host/index.js';
import { BASE, HEAD, id, LIVE_TREE } from './fixtures/live-worker.js';

const binding = { repoId: 'repo-immo', branch: 'artifact/p/alice/demo', subPath: '', state: 'attached', generation: 2 };
const draft = (revision: string): LiveDraftSnapshot => ({ revision, baseHeadSha: HEAD, liveTreeSha: LIVE_TREE,
  overlay: [{ path: 'a.txt', text: revision, mode: '100644' }] });
const fences = { current: async () => ({ ownerId: 'owner-alice', liveSessionId: 'sess-1', leaseEpoch: 4, routeEpoch: 3 }) };

/** A builder whose every answer takes a few ms, so unserialized calls would interleave; it ACKs the last sealed revision. */
function slowBuilder(refuse: (path: string, revision: string) => boolean = () => false) {
  const log: string[] = []; let sealed = '';
  const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
    const path = String(url).slice(BASE.length + 1); const body = JSON.parse(String(init.body));
    log.push(`${path}:${body.revision ?? body.invitation?.epoch ?? ''}`);
    await new Promise(resolve => setTimeout(resolve, 5));
    if (refuse(path, body.revision)) return new Response(JSON.stringify({ error: 'builder_unavailable' }), { status: 503 });
    if (path.endsWith('/seal')) sealed = body.revision;
    if (!path.endsWith('/reconcile')) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ liveSessionId: body.liveSessionId, leaseEpoch: body.leaseEpoch, routeEpoch: body.routeEpoch,
      revision: sealed, ready: true }), { status: 200 });
  });
  return { fetcher, log };
}
const worker = (fetcher: unknown, revisions: string[], over: Partial<LiveWorkerClientOptions> = {}) => {
  const queue = [...revisions];
  return createLiveWorkerClient({ baseUrl: BASE, identity: { authorization: async () => 'Bearer s2s' }, fetch: fetcher as typeof fetch,
    bindings: { get: async () => binding as never }, sessionState: async () => ({ epoch: 1, expiresAt: null }), fences,
    drafts: { current: async () => draft(queue.length > 1 ? queue.shift()! : queue[0]!) }, ...over });
};

afterEach(() => { vi.restoreAllMocks(); });

describe('live-host worker client: one stage+reconcile at a time per artifact', () => {
  it('runs concurrent reconciles one after the other, so a late seal never overwrites the newer revision', async () => {
    const builder = slowBuilder(); const client = worker(builder.fetcher, ['rev-A', 'rev-B']);
    const [first, second] = await Promise.all([client.reconcile(id), client.reconcile(id)]);
    expect(builder.log).toEqual(['v1/live/draft/page:rev-A', 'v1/live/draft/seal:rev-A', 'v1/live/reconcile:1',
      'v1/live/draft/page:rev-B', 'v1/live/draft/seal:rev-B', 'v1/live/reconcile:1']);
    expect([first?.revision, second?.revision]).toEqual(['rev-A', 'rev-B']);
  });

  it('keeps the lane open after a refused reconcile and runs a stop after the reconcile in flight', async () => {
    const builder = slowBuilder((path, revision) => path.endsWith('/page') && revision === 'rev-A');
    const client = worker(builder.fetcher, ['rev-A', 'rev-B']);
    const results = await Promise.allSettled([client.reconcile(id), client.reconcile(id),
      client.stop({ ...id, liveSessionId: 'sess-1', leaseEpoch: 4 })]);
    expect(results.map(r => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
    expect(builder.log).toEqual(['v1/live/draft/page:rev-A', 'v1/live/draft/page:rev-B', 'v1/live/draft/seal:rev-B',
      'v1/live/reconcile:1', 'v1/live/stop:']);
  });

  it('waits longer for the reconcile than for page, seal and stop calls', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await worker(slowBuilder().fetcher, ['rev-A']).reconcile(id);
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([10_000, 10_000, 30_000]);
    timeout.mockClear();
    const tuned = worker(slowBuilder().fetcher, ['rev-A'], { timeoutMs: 2_000, reconcileTimeoutMs: 40_000 });
    await tuned.reconcile(id); await tuned.stop({ ...id, liveSessionId: 'sess-1', leaseEpoch: 4 });
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([2_000, 2_000, 40_000, 2_000]);
  });

  it('keeps the session epoch floor per storage scope', async () => {
    const builder = slowBuilder(); let epoch = 5;
    const client = worker(builder.fetcher, ['rev-A'], { sessionState: async () => ({ epoch, expiresAt: null }) });
    await client.reconcile(id); epoch = 1;
    await client.reconcile({ ...id, storageScopeId: 'scope-b' }); await client.reconcile(id);
    expect(builder.log.filter(line => line.startsWith('v1/live/reconcile'))).toEqual(['v1/live/reconcile:5', 'v1/live/reconcile:1',
      'v1/live/reconcile:5']);
  });
});
