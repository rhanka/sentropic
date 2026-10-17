import { describe, expect, it } from 'vitest';
import type { AtomicUnit } from '../../src/storage/atomic.js';
import { grantFor } from './authority-corpus.js';
import { TestStagedReferenceStore, type TestStagedStore } from './reference-staged.js';
import { runStagedFenceRotationCorpus, runStagedOwnershipCorpus } from './staged-integrity-corpus.js';

describe('K2b r3 staged integrity', () => {
  it('should own nested bytes and hide audit effects with colliding foreign ids', async () => {
    const store = new TestStagedReferenceStore('comments');
    const local = store.bindStaged(grantFor({ token: 'local', operations: ['read', 'write', 'maintain'] }));
    const foreign = store.bindStaged(grantFor({
      token: 'foreign', operations: ['read', 'write', 'maintain'],
      scope: { tenantId: 'tenant-a', workspaceId: 'foreign' },
    }));
    await runStagedOwnershipCorpus(local, foreign);
  });

  it('should refuse a formerly valid fence after its owner rotates it', async () => {
    const store = new TestStagedReferenceStore('comments');
    const bound = store.bindStaged(grantFor({ operations: ['read', 'write', 'maintain'] }));
    await runStagedFenceRotationCorpus(bound, (fence) => store.rotateFence(bound.scope, fence));
  });
});

const mutatedPair = (mutate: (bound: TestStagedStore) => void) => {
  const store = new TestStagedReferenceStore('comments');
  const local = store.bindStaged(grantFor({ token: 'local', operations: ['read', 'write', 'maintain'] }));
  const foreign = store.bindStaged(grantFor({
    token: 'foreign', operations: ['read', 'write', 'maintain'],
    scope: { tenantId: 'tenant-a', workspaceId: 'foreign' },
  }));
  mutate(local);
  mutate(foreign);
  return { store, local, foreign };
};
const internals = (bound: TestStagedStore) => (bound as unknown as {
  staged: { units: Map<string, { fragments: { effects: AtomicUnit }[] }>; audit: unknown[] };
}).staged;

describe('K2b r3 staged integrity mutations', () => {
  it('should kill scope-blind handles at the deliberate id collision', async () => {
    const { local, foreign } = mutatedPair((bound) => {
      const inner = bound.requireStagedHandle.bind(bound);
      bound.requireStagedHandle = (handle) => inner({ ...handle, moduleId: 'comments', scope: bound.scope });
    });
    await expect(runStagedOwnershipCorpus(local, foreign)).rejects.toThrow(/C03: a colliding foreign handle cannot stage/);
  });

  it.each(['record', 'append'] as const)('should kill a nested %s alias through exact bytes', async (kind) => {
    const { local, foreign } = mutatedPair((bound) => {
      const inner = bound.stageFragment.bind(bound);
      bound.stageFragment = (input) => {
        const receipt = inner(input);
        const fragment = internals(bound).units.get(input.unit.operationKey)!.fragments.at(-1)!;
        if (kind === 'record') Object.assign(fragment.effects.records[0], { bytes: input.effects.records[0].bytes });
        else Object.assign(fragment.effects.appends[0], { record: input.effects.appends[0].record });
        return receipt;
      };
    });
    const target = kind === 'record' ? /C01: nested record bytes are owned at acceptance/ : /C01: nested append bytes are owned at acceptance/;
    await expect(runStagedOwnershipCorpus(local, foreign)).rejects.toThrow(target);
  });

  it('should kill premature audit publication at its hidden audit assertion', async () => {
    const { local, foreign } = mutatedPair((bound) => {
      const inner = bound.stageFragment.bind(bound);
      bound.stageFragment = (input) => {
        const receipt = inner(input);
        internals(bound).audit.push({ stagedUnit: input.unit.unitId });
        return receipt;
      };
    });
    await expect(runStagedOwnershipCorpus(local, foreign)).rejects.toThrow(/C01: staged effects stay invisible to the audit reader/);
  });

  it('should kill a begin-fence-only check after the current fence rotates', async () => {
    const { store, local } = mutatedPair((bound) => { bound.requireCurrentFence = () => undefined; });
    await expect(runStagedFenceRotationCorpus(local, (fence) => store.rotateFence(local.scope, fence)))
      .rejects.toThrow(/C03: a superseded fence cannot publish/);
  });
});
