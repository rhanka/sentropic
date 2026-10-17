import { describe, expect, it } from 'vitest';
import { createCommentsModule, createCommentsPostgresRegistration } from '../../src/comments/index.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import { conformanceCapacity, conformanceScope } from '../../assets/storage/comments/oracle/conformance.mjs';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
describe.skipIf(!pgEnabled)('installed comments binding on a single transaction session', () => {
  it('revalidates nested store bindings on the existing session without acquiring another transaction', async () => {
    const fixture = await createPgFixture(await createCommentsPostgresRegistration()); let active = false;
    try {
      const driver = { transaction: async (options, operation) => {
        if (active) throw new Error('unexpected nested external transaction');
        active = true; try { return await fixture.options.driver.transaction(options, operation); } finally { active = false; }
      } };
      const root = await createPostgresKernel({ ...fixture.options, driver }); const scope = conformanceScope(); const grant = grantFor({ scope }); await root.bindNew(grant);
      const module = createCommentsModule({ storage: root.adapter(), capacity: conformanceCapacity() });
      await module.withContext(grant, () => module.store.transaction().run(async () => {
        expect(await module.store.getAnnotationHead(scope, 'missing')).toBeNull();
        throw new Error('expected caller rollback');
      })).then(() => { throw new Error('rollback was swallowed'); }, (error) => { expect(error.message).toBe('expected caller rollback'); });
    } finally { await fixture.close(); }
  });
});
