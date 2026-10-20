import { describe, expect, it } from 'vitest';
import { createStagedKernel, MemoryBackend } from '../../src/storage/index.js';
import { createIndexedBackendScopeState } from '../../src/storage/backend.js';
import { StorageDeniedError } from '../../src/storage/errors.js';
import { grantFor } from './authority-corpus.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import { stagedDigestOf, stagedSealRoot } from './staged-corpus.js';

describe('public staged storage ports', () => {
  it('should execute the actual port for every advertised profile', async () => {
    const root = createStagedKernel({ moduleId: 'comments' });
    const bound = root.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
    const atomic = bound.capability('atomic-units-v1').port;
    await atomic.commitAtomic({ ...emptyEffects(), records: [{ key: 'ordinary', contentHash: 'h', bytes: { format: 'utf8', data: '{}' } }] });
    const chains = bound.capability('immutable-chains-v1').port;
    await chains.appendChain('chain', { id: 'r', hash: 'head', bytes: '{}' }, { kind: 'absent', allocation: '0' });
    expect((await chains.readChain('chain')).length).toBe(1);
    const boundaries = bound.capability('immutable-boundaries-v1').port;
    expect((await boundaries.readPage('chain', 1, null, 4096)).records).toHaveLength(1);
    const captured = await boundaries.captureManifest({ selections: ['chain'] });
    expect((await boundaries.verifyManifest(captured.digest)).heads.chain.head).toBe('head');
    expect((await boundaries.readManifestPage(captured.digest, 'chain', 1, null, 4096)).records).toHaveLength(1);
    const fences = bound.capability('fenced-writers-v1').port;
    const fence = await fences.journalFence();
    const outbox = bound.capability('scope-outbox-v1').port;
    const delivered = await outbox.read('ports', 0, 100);
    await outbox.checkpoint('ports', 0, delivered.watermark, fence);
    expect((await outbox.inspect('ports')).lag).toBe(0);
    const visibility = bound.capability('visibility-barriers-v1').port;
    await visibility.declareCoverage('parent', 'ordinary');
    expect(await visibility.readHead('chain')).toBe('head');
    const staged = bound.capability('staged-units-v1').port;
    const unit = await staged.begin({ operationKey: 'ports', inputDigest: 'input', contractDigest: 'contract-k2b', sourceBoundary: 'boundary-k2b', fence });
    const effects = { ...emptyEffects(), records: [{ key: 'staged', contentHash: 'h2', bytes: { format: 'utf8' as const, data: '{}' } }] };
    await staged.stage({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: stagedDigestOf(unit, '0', null, effects), effects, fence });
    const outcome = await staged.sealStep({ unit, root: stagedSealRoot(unit, [effects]), fence });
    if (outcome.state !== 'sealed') throw new Error('small qualified unit did not seal');
    expect((await staged.commit({ seal: outcome.seal, fence })).effectiveRecords).toBe(1);
    expect((await staged.inspect('ports')).state).toBe('committed');
    await expect(staged.abort({ unit, fence, reason: 'terminal' })).rejects.toMatchObject({ code: 'invalid-command' });
  });
  it('should refuse an unqualified private-live staging commitment policy', () => {
    expect(() => createStagedKernel({ moduleId: 'engram-live' })).toThrow();
  });
  it('should keep issuance, registries and mutation state unreachable from adapters', () => {
    const root = createStagedKernel({ moduleId: 'comments' });
    const grant = grantFor({ operations: ['read', 'write', 'maintain'] });
    const bound = root.bindNew(grant);
    const adapter = root.adapter();
    expect((root as unknown as Record<string, unknown>).armFailure).toBeUndefined();
    expect(Object.keys(adapter).sort()).toEqual(['bind', 'incarnation', 'moduleId']);
    for (const name of ['core', 'inner', 'ctx', 'staged', 'projections', 'sealStaged', 'armExternalFailure']) expect((bound as unknown as Record<string, unknown>)[name]).toBeUndefined();
    expect(Object.isFrozen(bound)).toBe(true);
    expect(Object.isFrozen(Object.getPrototypeOf(bound))).toBe(true);
    for (const claim of bound.profiles) {
      expect(claim.digest).toMatch(/^[0-9a-f]{64}$/);
      const capability = bound.capability(claim.profile);
      expect(Object.values(capability.port).some((value) => typeof value === 'function')).toBe(true);
      expect(Object.isFrozen(capability.port)).toBe(true);
    }
    expect(() => bound.capability('generations-v1')).toThrow();
    root.revoke(grant.token);
    expect(() => bound.capability('staged-units-v1')).toThrow();
  });

  it('should relay authority pins', async () => {
    let allowed = true;
    const root = createStagedKernel({ moduleId: 'comments', authority: { attest: () => { if (!allowed) throw new StorageDeniedError('host denied'); } } });
    const bound = root.bindNew(grantFor());
    allowed = false;
    await expect(bound.readHead('x')).rejects.toMatchObject({ code: 'denied' });
  });
  it('should preserve revocation across runtime recreation on one backend', () => {
    const backend = new MemoryBackend(createIndexedBackendScopeState);
    const root = createStagedKernel({ moduleId: 'comments', backend });
    const grant = grantFor();
    root.bindNew(grant);
    root.revoke(grant.token);
    const recreated = createStagedKernel({ moduleId: 'comments', backend });
    expect(() => recreated.bindNew(grant)).toThrow(StorageDeniedError);
  });
});
