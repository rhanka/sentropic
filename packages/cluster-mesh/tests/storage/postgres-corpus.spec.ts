import { describe, it } from 'vitest';
import { pgEnabled } from './pg-driver.js';
import { createPgFixture } from './pg-fixture.js';
import { pgCorpusClient } from './pg-client.js';
import { grantFor } from './authority-corpus.js';
import { runAtomicCorpus } from './atomic-corpus.js';
import { runStagedCorpus, type StagedCorpusStore } from './staged-corpus.js';
import { runBarrierCorpus, type BarrierCorpusStore } from './barrier-corpus.js';
describe.skipIf(!pgEnabled)('shared corpora on injected Postgres', () => {
  it('preserves the shared ordinary atomic contract with module effects', async () => {
    const fixture = await createPgFixture();
    try {
      const bound = await (await fixture.open()).bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      await bound.configureLifecycle('optional');
      await runAtomicCorpus(bound, { visibilityBarriers: true, relationships: true, purgeJobs: true });
    } finally { await fixture.close(); }
  });
  it('preserves the shared staged protocol and foreign-scope refusals', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open(); const grant = grantFor({ operations: ['read', 'write', 'maintain'] });
      const foreign = grantFor({ token: 'foreign', scope: { tenantId: 'foreign', workspaceId: 'workspace' }, operations: ['read', 'write', 'maintain'] });
      const bound = pgCorpusClient(root, grant, await root.bindNew(grant));
      const other = pgCorpusClient(root, foreign, await root.bindNew(foreign));
      await runStagedCorpus(bound as unknown as StagedCorpusStore, { breakAuthority: () => root.revoke(grant.token) }, other as unknown as StagedCorpusStore);
    } finally { await fixture.close(); }
  });
  it('preserves the shared dependent-barrier and imported tombstone contract', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open(); const grant = grantFor({ operations: ['read', 'write', 'maintain'] });
      await runBarrierCorpus(pgCorpusClient(root, grant, await root.bindNew(grant)) as unknown as BarrierCorpusStore);
    } finally { await fixture.close(); }
  });
});
