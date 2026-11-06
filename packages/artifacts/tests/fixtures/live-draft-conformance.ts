import { describe, expect, it } from 'vitest';
import { createLiveDraftVault, type LiveStore } from '../../src/server/live-drafts.js';

export const liveIdentity = { storageScopeId: 'scope-a', artifactId: '11111111-1111-4111-8111-111111111111',
  bindingGeneration: 1 };
export function draftConformance(name: string, fresh: () => Promise<LiveStore>) {
  describe(name, () => {
    async function setup() {
      const store = await fresh();
      let clock = Date.parse('2026-11-06T12:00:00Z');
      const keys = { current: async () => ({ version: 'k1', key: Buffer.alloc(32, 7) }),
        resolve: async () => Buffer.alloc(32, 7) };
      const vault = createLiveDraftVault({ store, keys, now: () => clock });
      const save = (revision: string | null, command = 'write-1', text = 'private source') => vault.write({
        identity: liveIdentity, expectedRevision: revision, baseHeadSha: 'a'.repeat(40),
        baseTreeSha: 'b'.repeat(40), liveTreeSha: 'c'.repeat(40),
        overlay: [{ path: 'ui/page.ts', text, mode: '100644' }],
        command: { actorId: 'alice', key: command, hash: command + text, operation: 'live_write' },
      });
      return { store, vault, keys, save, advance: (ms: number) => { clock += ms; } };
    }
    it('should durably recover exact text through a fresh vault and isolate scope/generation', async () => {
      const { store, vault, keys, save } = await setup();
      const written = await save(null);
      expect(written.replayed).toBe(false);
      const reopened = createLiveDraftVault({ store, keys, now: () => Date.parse('2026-11-06T12:01:00Z') });
      expect((await reopened.read(liveIdentity))?.overlay[0].text).toBe('private source');
      expect(await vault.read({ ...liveIdentity, storageScopeId: 'scope-b' })).toBeUndefined();
      expect(await vault.read({ ...liveIdentity, bindingGeneration: 2 })).toBeUndefined();
    });
    it('should preserve the complete prior revision on cap, encryption or transaction failure', async () => {
      const { vault, save } = await setup();
      const first = await save(null);
      await expect(save(first.revision, 'oversize', 'x'.repeat(1024 * 1024 + 1))).rejects.toMatchObject({ kind: 'limit_exceeded' });
      expect((await vault.read(liveIdentity))?.revision).toBe(first.revision);
    });
    it('should serialize two clients and retain durable command replay without overwriting newer text', async () => {
      const { vault, save } = await setup();
      const first = await save(null);
      const results = await Promise.allSettled([save(first.revision, 'a', 'new a'), save(first.revision, 'b', 'new b')]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(await save(null)).toMatchObject({ revision: first.revision, replayed: true });
      expect((await vault.read(liveIdentity))?.overlay[0].text).toMatch(/^new [ab]$/);
      await expect(save(null, 'write-1', 'different')).rejects.toMatchObject({ kind: 'command_conflict' });
    });
    it('should expire with a tombstone and refuse stale replay resurrection or renewal', async () => {
      const { vault, save, advance } = await setup();
      const first = await save(null);
      advance(7 * 24 * 3600 * 1000);
      await expect(vault.read(liveIdentity)).rejects.toMatchObject({ kind: 'git_live_draft_expired' });
      expect(await save(null)).toMatchObject({ revision: first.revision, replayed: true });
      await expect(vault.renew(liveIdentity, first.revision)).rejects.toMatchObject({ kind: 'git_live_draft_expired' });
    });
    it('should authenticate renewed expiry and keep passive reads from extending retention', async () => {
      const { vault, save, advance } = await setup();
      const first = await save(null);
      advance(3600 * 1000);
      expect((await vault.read(liveIdentity))?.expiresAt).toBe(first.expiresAt);
      const renewed = await vault.renew(liveIdentity, first.revision);
      expect(renewed.expiresAt > first.expiresAt).toBe(true);
      expect(renewed.objectRef).not.toBe(first.objectRef);
      expect((await vault.read(liveIdentity))?.overlay[0].text).toBe('private source');
    });
    it('should serialize renewal with collection and preserve the winning authenticated object', async () => {
      const { vault, save, advance } = await setup();
      const first = await save(null); advance(3600000);
      await Promise.all([vault.renew(liveIdentity, first.revision), vault.collect(liveIdentity)]);
      expect((await vault.read(liveIdentity))?.overlay[0].text).toBe('private source');
      advance(8 * 24 * 3600000);
      expect(await vault.collect(liveIdentity)).toBeGreaterThan(0);
      await expect(vault.read(liveIdentity)).rejects.toMatchObject({ kind: 'git_live_draft_expired' });
    });
    it('should preserve the complete revision when key access or transaction completion fails', async () => {
      const { vault, save, store, keys } = await setup();
      const first = await save(null);
      const failed = createLiveDraftVault({ store, keys: { ...keys, current: async () => { throw new Error('private key outage'); } } });
      await expect(failed.write({ identity: liveIdentity, expectedRevision: first.revision,
        baseHeadSha: first.baseHeadSha, baseTreeSha: first.baseTreeSha, liveTreeSha: first.liveTreeSha,
        overlay: [{ path: 'ui/a.ts', text: 'must not replace', mode: '100644' }] }))
        .rejects.toMatchObject({ kind: 'git_live_draft_unavailable' });
      expect((await vault.read(liveIdentity))?.revision).toBe(first.revision);
      await expect(store.transaction(liveIdentity, async tx => {
        tx.record!.revision = 'must-roll-back'; throw new Error('injected transaction failure');
      })).rejects.toThrow();
      expect((await vault.read(liveIdentity))?.revision).toBe(first.revision);
    });
  });
}
