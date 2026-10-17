import { describe, expect, it } from 'vitest';
import { pgEnabled } from './pg-driver.js';
import { createPgFixture } from './pg-fixture.js';
import { grantFor } from './authority-corpus.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import type { InjectedPgDriver } from '../../src/storage/postgres/protocol.js';
describe.skipIf(!pgEnabled)('real publication races and uncertain responses', () => {
  it('allows one competing head and resolves a committed but unacknowledged operation', async () => {
    const fixture = await createPgFixture();
    try {
      const grant = grantFor({ operations: ['read', 'write', 'maintain'] }); const root = await fixture.open(); const a = await root.bindNew(grant);
      await a.appendChain('race', { id: 'base', hash: 'base', bytes: '{}' }, { kind: 'absent', allocation: '0' });
      const b = await (await fixture.open()).bind(grant);
      const outcomes = await Promise.allSettled([a.appendChain('race', { id: 'a', hash: 'a', bytes: '{}' }, { kind: 'head', hash: 'base' }), b.appendChain('race', { id: 'b', hash: 'b', bytes: '{}' }, { kind: 'head', hash: 'base' })]);
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      let armed = false;
      const driver: InjectedPgDriver = { transaction: async (options, operation) => {
        const value = await fixture.options.driver.transaction(options, operation);
        if (armed) { armed = false; throw { phase: 'commit', outcome: 'unknown' }; } return value;
      } };
      const uncertain = await (await createPostgresKernel({ ...fixture.options, driver })).bind(grant);
      const input = { ...emptyEffects(), records: [{ key: 'durable', bytes: { format: 'utf8' as const, data: 'committed' }, contentHash: 'h' }], moduleResult: { format: 'utf8' as const, data: '{"receipt":"complete"}' } };
      // Omit command id on this probe so the injected failure follows the
      // publishing transaction rather than an initial receipt lookup.
      armed = true;
      await expect(uncertain.commitAtomic(input)).rejects.toMatchObject({ condition: 'outcome_unknown' });
      expect((await a.readRecord('durable'))?.bytes.data).toBe('committed');
      const keyed = await a.commitAtomic({ ...emptyEffects(), indexWrites: [{ key: 'recovered', digest: 'd', resultIds: ['durable'], resultHash: 'h' }], moduleResult: input.moduleResult }, { idempotencyKey: 'recover' });
      expect(await b.commitAtomic({ ...emptyEffects(), indexWrites: [{ key: 'recovered', digest: 'd', resultIds: ['durable'], resultHash: 'h' }], moduleResult: input.moduleResult }, { idempotencyKey: 'recover' })).toEqual(keyed);
    } finally { await fixture.close(); }
  });
});
