import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
import { PgRoots } from '../../src/storage/postgres/roots.js';
import { PgCore } from '../../src/storage/postgres/core.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import { stagedSealRoot, stagedDigestOf } from './staged-corpus.js';
import type { InjectedPgDriver } from '../../src/storage/postgres/protocol.js';
const scopeProbe = async () => {
  const fixture = await createPgFixture();
  try {
    const root = await fixture.open(); const a = await root.bindNew(grantFor({ token: 'a', operations: ['read', 'write', 'maintain'] }));
    const b = await root.bindNew(grantFor({ token: 'b', scope: { tenantId: 'tenant-a', workspaceId: 'another-workspace' }, operations: ['read', 'write', 'maintain'] }));
    await a.appendChain('collision', { id: 'a', hash: 'private', bytes: 'private' }, { kind: 'absent', allocation: '0' });
    assert.equal(await b.readHead('collision'), null, 'PG scope probe: another workspace cannot read a colliding key');
  } finally { await fixture.close(); }
};
const fenceProbe = async () => {
  const fixture = await createPgFixture();
  try {
    const root = await fixture.open(); const grant = grantFor({ operations: ['read', 'write', 'maintain'] }); const bound = await root.bindNew(grant);
    const fence = { fenceId: 'writer', epoch: '1' }; await root.provisionFence(grant, fence);
    const unit = await bound.beginStaged({ operationKey: 'fence', inputDigest: 'input', contractDigest: 'contract-k2b', sourceBoundary: 'boundary-k2b', fence });
    const effects = { ...emptyEffects(), records: [{ key: 'target', bytes: { format: 'utf8' as const, data: 'secret' }, contentHash: 'h' }] };
    await bound.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: stagedDigestOf(unit, '0', null, effects), effects, fence });
    let seal;
    do { seal = (await bound.sealStep({ unit, root: stagedSealRoot(unit, [effects]), fence, limits: { maxRecords: 128, maxAppends: 128, maxEncodedBytes: 524288 } })).seal; } while (!seal);
    await root.provisionFence(grant, { ...fence, epoch: '2' });
    await assert.rejects(() => bound.commitStaged(seal!, fence), { code: 'invalid-command' }, 'PG fence probe: a valid old capability cannot publish after rotation');
  } finally { await fixture.close(); }
};
const erasureProbe = async (omitErase = false) => {
  const fixture = await createPgFixture();
  try {
    const driver: InjectedPgDriver = { transaction: (options, operation) => fixture.options.driver.transaction(options, (session) => operation({ execute: (statement) => session.execute({ ...statement,
      text: omitErase ? statement.text.replace('SET bytes=NULL,erased=true', 'SET erased=false') : statement.text,
    }) })) };
    const root = await createPostgresKernel({ ...fixture.options, driver }); const grant = grantFor({ operations: ['read', 'write', 'maintain'] }); const bound = await root.bindNew(grant);
    await bound.configureLifecycle('optional');
    await bound.appendChain('target', { id: 'a', hash: 'a', bytes: 'private content' }, { kind: 'absent', allocation: '0' });
    await bound.commitAtomic({ ...emptyEffects(), purgeIntents: [{ intentId: 'purge', target: 'target', authorizedBy: grant.principalId }] });
    assert.equal((await bound.completePurge('purge')).payloadDisposition, 'erased');
    const row = await fixture.tx.run(true, async (session) => (await session.execute({ text: `SELECT bytes FROM "${fixture.name}".payloads WHERE target='target'`, values: [] })).rows[0]);
    assert.equal(row?.bytes, null, 'PG erasure probe: an erased result requires actual bytea erasure');
  } finally { await fixture.close(); }
};
describe.skipIf(!pgEnabled)('discriminating production Postgres mutations', () => {
  it('kills a workspace omission in the actual root key function', async () => {
    await scopeProbe();
    const mutant = vi.spyOn(PgRoots.prototype, 'key').mockImplementation(function (scope) { return JSON.stringify([this.options.moduleId, scope.tenantId]); });
    try { await expect(scopeProbe()).rejects.toThrow(/PG scope probe/); } finally { mutant.mockRestore(); }
  });
  it('kills omitted database fence checks with otherwise valid unit and seal capabilities', async () => {
    await fenceProbe(); const mutant = vi.spyOn(PgCore.prototype, 'fence').mockResolvedValue(undefined);
    try { await expect(fenceProbe()).rejects.toThrow(/PG fence probe/); } finally { mutant.mockRestore(); }
  });
  it('kills a false erased receipt when the real SQL payload update retains bytes', async () => {
    await erasureProbe(); await expect(erasureProbe(true)).rejects.toThrow(/PG erasure probe/);
  });
});
