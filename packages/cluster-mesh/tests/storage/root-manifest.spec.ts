import { describe, expect, it } from 'vitest';
import { createStagedKernel } from '../../src/storage/index.js';
import { grantFor } from './authority-corpus.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';

describe('storage-bound manifest ports', () => {
  it('should capture real heads, read the retained boundary and reject unissued or foreign roots', async () => {
    const root = createStagedKernel({ moduleId: 'comments', cursorSecret: 'manifest-test' });
    const bound = root.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
    await bound.appendChain('a', { id: 'a0', hash: 'h0', bytes: '{}' }, { kind: 'absent', allocation: '0' });
    await bound.appendChain('a', { id: 'a1', hash: 'h1', bytes: '{}' }, { kind: 'head', hash: 'h0' });
    const captured = await bound.captureManifest({ selections: ['a'] });
    const secondOwner = root.bindNew(grantFor({ token: 'second-owner', principalId: 'user-2', operations: ['read'] }));
    await secondOwner.captureManifest({ selections: ['a'] });
    expect((await bound.verifyManifest(captured.digest)).heads.a.head).toBe('h1');
    expect(captured.manifest.heads.a).toEqual({ head: 'h1', allocation: '2', terminalSeq: '1' });
    await bound.appendChain('a', { id: 'a2', hash: 'h2', bytes: '{}' }, { kind: 'head', hash: 'h1' });
    const first = await bound.manifestReadPage(captured.digest, 'a', 1, null, 4096);
    const last = await bound.manifestReadPage(captured.digest, 'a', 1, first.nextCursor, 4096);
    expect([...first.records, ...last.records].map((record) => record.hash)).toEqual(['h0', 'h1']);
    expect(last.nextCursor).toBeNull();
    expect((await bound.verifyManifest(captured.digest)).heads.a.head).toBe('h1');
    await expect(bound.verifyManifest('caller-selected-digest')).rejects.toMatchObject({ code: 'invalid-command' });
    await expect(bound.captureManifest({ selections: ['missing'] })).rejects.toMatchObject({ code: 'invalid-command' });
    await expect(bound.captureManifest({ selections: ['a'], operationKeys: ['uncommitted'] })).rejects.toMatchObject({ code: 'invalid-command' });
    const foreign = root.bindNew(grantFor({ token: 'foreign-manifest', scope: { tenantId: 'other', workspaceId: 'w' } }));
    await expect(foreign.verifyManifest(captured.digest)).rejects.toMatchObject({ code: 'invalid-command' });
    await bound.commitAtomic({ ...emptyEffects(), barriers: [{ boundary: 'a', reason: 'hidden' }] });
    expect((await bound.manifestReadPage(captured.digest, 'a', 1, first.nextCursor, 4096)).outcome).toBe('inaccessible');
    await expect(bound.verifyManifest(captured.digest)).rejects.toMatchObject({ code: 'denied' });
  });
});
