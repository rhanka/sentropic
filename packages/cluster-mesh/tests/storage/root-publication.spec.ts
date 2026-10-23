import { describe, expect, it } from 'vitest';
import { createStagedKernel } from '../../src/storage/index.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import { grantFor } from './authority-corpus.js';
import { FENCE, sealPublic, stagePublic } from './root-protocol-fixture.js';

const grant = () => grantFor({ operations: ['read', 'write', 'maintain'] });
const record = { key: 'payload', contentHash: 'hash', bytes: { format: 'utf8' as const, data: 'payload bytes' } };
describe('single root publication under interleaving', () => {
  it('should expose hidden state before the gate and the covering barrier with publication', async () => {
    const root = createStagedKernel({ moduleId: 'comments' });
    const bound = root.bindNew(grant());
    const staged = await stagePublic(root, bound, 'atomic-barrier', { ...emptyEffects(), records: [record], barriers: [{ boundary: 'payload', reason: 'imported tombstone' }] });
    const seal = await sealPublic(bound, staged);
    const publication = bound.commitStaged({ seal, fence: FENCE });
    const hidden = bound.readRecord('payload');
    const journal = bound.journalRead('observer', 0, 100);
    expect(await hidden).toBeNull();
    expect((await journal).events).toEqual([]);
    const receipt = await publication;
    await expect(bound.readRecord('payload')).rejects.toMatchObject({ code: 'denied' });
    expect((await bound.journalRead('observer', 0, 100)).events.map((event) => event.commitId)).toEqual([receipt.commitId]);
  });
  it.each(['authority', 'fence'] as const)('should revalidate %s after a publication wait', async (kind) => {
    const root = createStagedKernel({ moduleId: 'comments' });
    const bound = root.bindNew(grant());
    const staged = await stagePublic(root, bound, `stale-${kind}`, { ...emptyEffects(), records: [record] });
    const seal = await sealPublic(bound, staged);
    const publication = bound.commitStaged({ seal, fence: FENCE });
    if (kind === 'authority') root.revoke(bound.grant.token); else root.rotateFence(bound.scope, { ...FENCE, epoch: '2' });
    await expect(publication).rejects.toMatchObject({ code: kind === 'authority' ? 'denied' : 'invalid-command' });
    const observer = root.bindNew(grantFor({ token: 'fresh-observer', operations: ['read'] }));
    expect(await observer.readRecord('payload')).toBeNull();
    expect((await observer.journalRead('observer', 0, 100)).events).toEqual([]);
  });
  it('should conflict on a rival index replacement while preserving the rival results', async () => {
    const root = createStagedKernel({ moduleId: 'comments' });
    const bound = root.bindNew(grant());
    await bound.indexPut('command', { digest: 'same-digest', resultIds: ['old'], resultHash: null });
    const staged = await stagePublic(root, bound, 'index-race', { ...emptyEffects(), records: [record] });
    const seal = await sealPublic(bound, staged);
    await bound.indexPut('command', { digest: 'same-digest', resultIds: ['winner'], resultHash: null });
    await expect(bound.commitStaged({ seal, fence: FENCE })).rejects.toMatchObject({ code: 'cas-conflict' });
    expect((await bound.indexGet('command'))?.resultIds).toEqual(['winner']);
    expect(await bound.readRecord('payload')).toBeNull();
  });
});
