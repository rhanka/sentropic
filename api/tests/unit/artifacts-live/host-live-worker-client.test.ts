import { describe, expect, it, vi } from 'vitest';
import { createLiveWorkerClient, type LiveDraftSnapshot } from '@sentropic/artifacts/live-host';
import { key } from './fixture';
import { podName } from '../../../src/services/artifacts/live/pods';
import { binding, fences, HEAD, setup, TREE } from './host-live-harness';

const BASE = 'https://builder.test/api/v1/artifacts/builder';
const identity = { ...key, bindingGeneration: 1 };

/** The package LiveWorkerPort client against the real host live API: the generic stager must satisfy the builder contract. */
function worker(s: ReturnType<typeof setup>, draft: LiveDraftSnapshot) {
  const paths: string[] = [];
  const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
    const path = String(url).split('/v1/live/')[1]!; paths.push(path);
    return s.call(path, String(init.body));
  });
  const client = createLiveWorkerClient({ baseUrl: BASE, identity: { authorization: async () => 'Bearer s2s' },
    fetch: fetcher as unknown as typeof fetch,
    fences: { current: async () => ({ ownerId: 'owner', ...fences }) },
    bindings: { get: async () => ({ ...binding, artifactId: key.artifactId, storageScopeId: key.storageScopeId, state: 'attached',
      generation: 1 }) as never },
    sessionState: async () => ({ epoch: 1, expiresAt: null }),
    drafts: { current: async () => draft } });
  return { client, paths };
}

describe('package live worker client against the host live API', () => {
  it('stages a dirty draft and reconciles it to LIVE with the runtime ownerId', async () => {
    const s = setup();
    const { client, paths } = worker(s, { revision: 'r1', baseHeadSha: HEAD, liveTreeSha: TREE, overlay: [
      { path: 'src/App.svelte', text: '<p>r1</p>', mode: '100644' }, { path: 'old.txt', text: null, mode: '100644' }] });
    await expect(client.reconcile(identity)).resolves.toEqual({ ...fences, revision: 'r1', ready: true });
    expect(paths).toEqual(['draft/page', 'draft/seal', 'reconcile']);
    expect((await s.f.state())?.runtime).toMatchObject({ phase: 'LIVE', ownerId: 'owner', appliedRevision: 'r1' });
    const staged = await s.drafts.draft({ podName: podName(key), generation: 1 } as never, { generation: 1, revision: 'r1' } as never);
    expect(staged).toEqual({ deletes: ['old.txt'],
      files: [{ path: 'src/App.svelte', mode: 0o644, bytes: new Uint8Array(Buffer.from('<p>r1</p>')) }] });
  });

  it('stages a clean draft as a seal of zero pages, so the reconcile is not draft_not_staged', async () => {
    const s = setup();
    const { client, paths } = worker(s, { revision: 'r0', baseHeadSha: HEAD, liveTreeSha: TREE, overlay: [] });
    await expect(client.reconcile(identity)).resolves.toEqual({ ...fences, revision: 'r0', ready: true });
    expect(paths).toEqual(['draft/seal', 'reconcile']);
  });
});
