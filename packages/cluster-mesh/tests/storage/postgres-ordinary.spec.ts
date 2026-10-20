import { describe, expect, it } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import { runChainCorpus } from './chain-corpus.js';
import { runReadCorpus } from './read-corpus.js';
const append = (hash: string, previous: string | null = null) => ({ ...emptyEffects(), appends: [{ chainId: 'chain', record: { id: hash, hash, bytes: `🌍${hash}` }, expectation: previous === null ? { kind: 'absent' as const, allocation: '0' } : { kind: 'head' as const, hash: previous } }] });
describe.skipIf(!pgEnabled)('Postgres ordinary root semantics', () => {
  it('rolls back when a transaction swallows an invalid pending operation', async () => {
    const fixture = await createPgFixture();
    try {
      const bound = await (await fixture.open()).bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      await expect(bound.transact({}, async (tx) => {
        await tx.apply(append('pending'));
        try { await tx.apply(emptyEffects()); } catch { /* the outer must remain rollback-only */ }
      })).rejects.toMatchObject({ code: 'invalid-command' });
      expect(await bound.readHead('chain')).toBeNull();
    } finally { await fixture.close(); }
  });
  it('retains frozen chain/read corpora on the real backend', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open();
      const bound = await root.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      await runChainCorpus(bound); await runReadCorpus(bound);
    } finally { await fixture.close(); }
  });
  it('owns byte buffers, preserves sequential CAS and recovers receipts after reopening', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open(); const grant = grantFor({ operations: ['read', 'write', 'maintain'] });
      const bound = await root.bindNew(grant);
      const first = await bound.commitAtomic(append('h0'), { idempotencyKey: 'initial' });
      await bound.transact({}, async (tx) => { await tx.apply(append('h1', 'h0')); expect(await tx.readHead('chain')).toBe('h1'); await tx.apply(append('h2', 'h1')); });
      await expect(bound.commitAtomic(append('stale', 'h0'))).rejects.toMatchObject({ code: 'cas-conflict' });
      const reopened = await fixture.open(); const resumed = await reopened.bind(grant);
      expect(await resumed.commitAtomic(append('h0'), { idempotencyKey: 'initial' })).toEqual(first);
      expect((await resumed.readChain('chain')).map((row) => row.hash)).toEqual(['h0', 'h1', 'h2']);
      const caller = { ...emptyEffects(), records: [{ key: 'record', contentHash: 'h', bytes: { format: 'utf8' as const, data: 'original' } }] };
      await resumed.commitAtomic(caller); caller.records[0]!.bytes.data = 'changed';
      expect((await resumed.readRecord('record'))?.bytes.data).toBe('original');
      await expect(resumed.commitAtomic(caller)).rejects.toMatchObject({ code: 'idempotency-conflict' });
      await root.revoke(grant.token);
      await expect(resumed.readHead('chain')).rejects.toMatchObject({ code: 'denied' });
      await expect((await fixture.open()).bindNew(grant)).rejects.toMatchObject({ code: 'denied' });
    } finally { await fixture.close(); }
  });
});
