import { describe, expect, it } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
describe.skipIf(!pgEnabled)('owned Postgres registration and authentication nonces', () => {
  it('owns layout data passed to trusted query handlers', async () => {
    const descriptor = { contractVersion: 'v1', contractDigest: 'owned', schemaVersions: ['1'], requiredProfiles: [], optionalProfiles: [], chainKinds: ['test'], queryNames: ['echo'], boundaries: ['scope'], pageLimits: { maxRecords: 100, maxEncodedBytes: 1048576 } };
    const fixture = await createPgFixture({ descriptor, queries: { echo: async (_input, context) => ({ records: [{ schema: context.layout.dataSchema }], nextCursor: null }) } });
    try {
      const bound = await (await fixture.open()).bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      fixture.options.layout.dataSchema = 'caller-mutated';
      expect((await bound.query('echo', {}, { limit: 1 })).records).toEqual([{ schema: fixture.name }]);
    } finally { await fixture.close(); }
  });
  it('keeps authentication nonces independent from a deterministic domain id source', async () => {
    const kinds: string[] = []; let counter = 0;
    const fixture = await createPgFixture({ ids: { next: (kind) => { kinds.push(kind); return `domain:${kind}:${counter++}`; } } });
    try {
      const root = await fixture.open(); const grant = grantFor({ operations: ['read', 'write', 'maintain'] }); const bound = await root.bindNew(grant);
      const fence = { fenceId: 'nonce', epoch: '1' }; await root.provisionFence(grant, fence);
      const unit = await bound.beginStaged({ operationKey: 'nonce', inputDigest: 'input', contractDigest: 'contract', sourceBoundary: 'source', fence });
      expect(unit.unitId).toMatch(/^domain:unit:/); expect(unit.capability).not.toMatch(/^domain:/); expect(kinds).not.toContain('unit-capability');
    } finally { await fixture.close(); }
  });
});
