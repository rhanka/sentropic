import { describe, expect, it } from 'vitest';
import { pgEnabled } from './pg-driver.js';
import { createPgFixture } from './pg-fixture.js';
import { grantFor } from './authority-corpus.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import { stagedCommitRoots, stagedFragmentDigest } from '../../src/storage/staged-codec.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';
import type { InjectedPgDriver, SqlStatement } from '../../src/storage/postgres/protocol.js';
describe.skipIf(!pgEnabled)('durable bounded staged preparation', () => {
  it('resumes each hidden step after reopening and publishes with bounded metadata work', async () => {
    const fixture = await createPgFixture();
    try {
      const statements: SqlStatement[] = [];
      const driver: InjectedPgDriver = { transaction: (options, operation) => fixture.options.driver.transaction(options, (session) => operation({ execute: (statement) => { statements.push(statement); return session.execute(statement); } })) };
      const open = () => createPostgresKernel({ ...fixture.options, driver });
      let root = await open(); const grant = grantFor({ operations: ['read', 'write', 'maintain'] });
      let bound = await root.bindNew(grant); const fence = { fenceId: 'import', epoch: '1' };
      await root.provisionFence(grant, fence);
      const begin = { operationKey: 'operation', inputDigest: 'input', contractDigest: 'contract', sourceBoundary: 'source', fence };
      const unit = await bound.beginStaged(begin); const fragments: { ordinal: string; effects: AtomicUnit }[] = [];
      let predecessor: string | null = null;
      for (let n = 0; n < 12; n += 1) {
        const ordinal = String(n);
        const effects = { ...emptyEffects(), appends: [{ chainId: 'imported', record: { id: `r${n}`, hash: `h${n}`, bytes: `🌍${'x'.repeat(4096)}` }, expectation: n === 0 ? { kind: 'absent' as const, allocation: '0' } : { kind: 'head' as const, hash: `h${n - 1}` } }] };
        const fragmentDigest = stagedFragmentDigest({ moduleId: 'comments', scope: grant.scope, ...begin, operationId: begin.operationKey, ordinal, predecessorHash: predecessor }, effects);
        await bound.stageFragment({ unit, ordinal, predecessorHash: predecessor, fragmentDigest, effects, fence });
        fragments.push({ ordinal, effects }); predecessor = fragmentDigest;
      }
      const commitRoot = { operationId: begin.operationKey, contractDigest: begin.contractDigest, sourceBoundary: begin.sourceBoundary, fragmentCount: String(fragments.length), finalFragmentHash: predecessor!, ...stagedCommitRoots(fragments) };
      let seal: Awaited<ReturnType<typeof bound.sealStep>>['seal'] = undefined;
      let steps = 0;
      do {
        root = await open(); bound = await root.bind(grant);
        const progress = await bound.sealStep({ unit, root: commitRoot, fence, limits: { maxRecords: 2, maxAppends: 1, maxEncodedBytes: 4500 } });
        expect(progress.work.items).toBeLessThanOrEqual(2); expect(progress.work.appends).toBeLessThanOrEqual(1); expect(progress.work.bytes).toBeLessThanOrEqual(4500);
        seal = progress.seal; steps += 1; expect(steps).toBeLessThan(60);
        expect(await bound.readHead('imported')).toBeNull();
      } while (!seal);
      const offset = statements.length;
      const receipt = await bound.commitStaged(seal, fence);
      const publication = statements.slice(offset);
      expect(publication.filter((s) => s.text.startsWith('UPDATE') && s.text.includes('.scopes '))).toHaveLength(1);
      expect(publication.some((s) => s.text.includes('staged_items'))).toBe(false);
      expect((await bound.readChain('imported')).map((record) => record.hash)).toEqual(fragments.map((_, n) => `h${n}`));
      const restarted = await (await open()).bind(grant);
      expect(await restarted.commitStaged(seal, fence)).toEqual(receipt);
      expect(await restarted.beginStaged(begin)).toMatchObject({ unitId: unit.unitId, state: 'committed' });
      await expect(restarted.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: 'changed', effects: fragments[0]!.effects, fence })).rejects.toMatchObject({ code: 'idempotency-conflict' });
    } finally { await fixture.close(); }
  });
});
