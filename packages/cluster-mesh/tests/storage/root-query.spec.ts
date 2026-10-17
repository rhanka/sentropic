import { describe, expect, it } from 'vitest';
import { createStagedKernel } from '../../src/storage/index.js';
import type { ModuleDescriptor } from '../../src/storage/descriptor.js';
import { grantFor } from './authority-corpus.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';

const descriptor: ModuleDescriptor = { contractVersion: 'q1', contractDigest: 'q1-digest', schemaVersions: ['1'],
  requiredProfiles: ['atomic-units-v1'], optionalProfiles: [], chainKinds: ['items'], queryNames: ['children'], boundaries: ['parent'],
  pageLimits: { maxRecords: 2, maxEncodedBytes: 4096 },
};
const setup = () => {
  const root = createStagedKernel({ moduleId: 'comments', descriptor,
    queries: { children: (input, context) => context.view.relationships('child', String(input), Number(context.cursor ?? 0), context.limit) },
  });
  const bound = root.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
  return { root, bound };
};
describe('protected registered root queries', () => {
  it('should own descriptor registration instead of accepting later caller edits', async () => {
    const names = ['children'];
    const root = createStagedKernel({ moduleId: 'comments', descriptor: { ...descriptor, queryNames: names },
      queries: { children: () => ({ records: [], nextCursor: null }), hidden: () => ({ records: ['leak'], nextCursor: null }) },
    });
    const bound = root.bindNew(grantFor());
    names.push('hidden');
    await expect(bound.query('hidden', 'p', { limit: 1, maxEncodedBytes: 4096 })).rejects.toMatchObject({ code: 'unsupported-profile' });
  });
  it('should execute bounded registered queries on a captured root with current authorization', async () => {
    const { root, bound } = setup();
    await bound.commitAtomic({ ...emptyEffects(), relationships: ['a', 'b', 'c'].map((to) => ({ kind: 'add', relation: 'child', from: 'p', to })) });
    const first = await bound.query('children', 'p', { limit: 2, maxEncodedBytes: 4096 });
    expect(first.records).toEqual(['a', 'b']);
    await bound.commitAtomic({ ...emptyEffects(), relationships: [{ kind: 'add', relation: 'child', from: 'p', to: 'd' }] });
    const last = await bound.query('children', 'p', { limit: 2, maxEncodedBytes: 4096, cursor: first.nextCursor });
    expect(last.records).toEqual(['c']);
    expect(last.nextCursor).toBeNull();
    await expect(bound.query('unknown', 'p', { limit: 1, maxEncodedBytes: 4096 })).rejects.toMatchObject({ code: 'unsupported-profile' });
    await expect(bound.query('children', 'p', { limit: 3, maxEncodedBytes: 4096 })).rejects.toMatchObject({ code: 'invalid-command' });
    await expect(bound.query('children', 'other', { limit: 1, maxEncodedBytes: 4096, cursor: first.nextCursor })).rejects.toMatchObject({ code: 'invalid-command' });
    await bound.commitAtomic({ ...emptyEffects(), barriers: [{ boundary: 'p', reason: 'hidden' }] });
    await expect(bound.query('children', 'p', { limit: 1, maxEncodedBytes: 4096, cursor: first.nextCursor })).rejects.toMatchObject({ code: 'denied' });
    root.revoke(bound.grant.token);
    await expect(bound.query('children', 'p', { limit: 1, maxEncodedBytes: 4096 })).rejects.toMatchObject({ code: 'denied' });
  });
  it('should reject sequential projection failure without publishing carriers or events', async () => {
    const { bound } = setup();
    await bound.commitAtomic({ ...emptyEffects(), relationships: [{ kind: 'add', relation: 'child', from: 'p', to: 'a' }] });
    const before = await bound.journalRead('c', 0, 100);
    await expect(bound.commitAtomic({ ...emptyEffects(), records: [{ key: 'carrier', contentHash: 'h', bytes: { format: 'utf8', data: '{}' } }],
      relationships: [0, 1].map(() => ({ kind: 'remove', relation: 'child', from: 'p', to: 'a' })),
    })).rejects.toMatchObject({ code: 'invalid-command' });
    expect(await bound.readRecord('carrier')).toBeNull();
    expect((await bound.query('children', 'p', { limit: 2, maxEncodedBytes: 4096 })).records).toEqual(['a']);
    expect(await bound.journalRead('c', 0, 100)).toEqual(before);
  });
});
