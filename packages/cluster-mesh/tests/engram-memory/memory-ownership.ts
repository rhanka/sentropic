import { expect, it } from 'vitest';
import { openModuleStorageCanonicalMemoryStoreV1 } from '@sentropic/engram/memory-substrate';
import type { MemoryCampaignHost } from './memory-pg-host.js';
import { pendingCapture, registerMemoryCase, valueOf } from './memory-corpus.js';
import { DEADLINE, NOW } from './memory-engine.js';
import { memoryNeutralGrant } from './pg-host.js';

export const runMemoryOwnershipCorpus = (open: () => Promise<MemoryCampaignHost>) => {
  const scenario = (name: string, run: (host: MemoryCampaignHost) => Promise<void>) => {
    registerMemoryCase(name);
    return it(name, async () => {
    const h = await open(); try { await run(h); } finally { await h.close(); }
    });
  };
  scenario('fenced-writers-v1/second-holder: should refuse a second installed constructor over the same host handle', async (h) => {
    const second = await openModuleStorageCanonicalMemoryStoreV1({ handle: h.handle, grant: h.binding.memoryGrant,
      scope_binding: h.scopeBinding, clock: { now: () => NOW }, deadline_at: DEADLINE });
    if (second.ok) await second.value.close();
    expect(second).toMatchObject({ ok: false, error: { code: 'FENCE_LOST' } });
    expect(valueOf(await h.store.readiness()).storage_epoch).toBe('1');
  });
  scenario('fenced-writers-v1/store-bijection: should refuse alternate store or scope identities and retain the legitimate binding', async (h) => {
    await expect(h.handle.acquireFence({ scope: h.scopeBinding.scope, store_id: 'alternate-store', grant: h.binding.memoryGrant }))
      .rejects.toMatchObject({ code: 'fence-conflict', message: 'store_id and scope must be bijective' });
    await expect(h.handle.acquireFence({ scope: { ...h.scopeBinding.scope, workspaceId: 'foreign' },
      store_id: h.scopeBinding.store_id, grant: h.binding.memoryGrant })).rejects.toMatchObject({ code: 'unauthorized' });
    await h.reopen();
    expect(valueOf(await h.store.readiness()).storage_epoch).toBe('2');
  });
  scenario('fenced-writers-v1/revocation: should deny both present and absent original-result lookups after memory authority is revoked', async (h) => {
    valueOf(await h.store.commitPending(pendingCapture()));
    const foreign = memoryNeutralGrant('foreign');
    await h.kernel.bindNew(foreign);
    for (const identity of ['capture-candidate-1', 'absent'])
      await expect(h.handle.readCommitResult!(identity, foreign)).rejects.toMatchObject({ code: 'unauthorized' });
    await h.kernel.revoke(h.binding.memoryGrant.token);
    for (const identity of ['capture-candidate-1', 'absent'])
      await expect(h.handle.readCommitResult!(identity, h.binding.memoryGrant)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(await h.store.readiness()).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    const fence = await (await h.kernel.bind(h.binding.maintainGrant)).journalFence();
    expect(await h.maintenance.checkFence(fence)).toEqual(fence);
  });
  scenario('fenced-writers-v1/final-guard: should latch a lost installed store and require a fresh acquisition', async (h) => {
    const lost = h.store;
    h.expireAtCommit();
    expect(await lost.commitPending(pendingCapture())).toMatchObject({ ok: false, error: { code: 'FENCE_LOST' } });
    expect(await lost.readiness()).toMatchObject({ ok: false, error: { code: 'FENCE_LOST' } });
    expect(await lost.readJournal({ after: '0', limit: 1 })).toMatchObject({ ok: false, error: { code: 'FENCE_LOST' } });
    await h.reopen();
    expect(valueOf(await h.store.readiness()).storage_epoch).toBe('2');
    valueOf(await h.store.commitPending(pendingCapture()));
    expect(await lost.readiness()).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
  });
};
