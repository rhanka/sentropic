import { describe, expect, it } from 'vitest';
import type { AtomicUnit } from '../../src/storage/atomic.js';
import { beginOperation, stageOperationFragment } from '../../src/storage/staged-operations.js';
import { sealOperationStep, commitSealedOperation, abortOperation, inspectOperation } from '../../src/storage/staged-seal.js';
import { stagedCommitRoots, stagedFragmentDigest } from '../../src/storage/staged-codec.js';
import { FENCE, stagedRootFixture } from './staged-root-fixture.js';

const prepare = (fixture: ReturnType<typeof stagedRootFixture>, count = 1) => {
  const { core, bound } = fixture;
  const begin = { operationKey: 'op', inputDigest: 'input', contractDigest: 'contract', sourceBoundary: 'source', fence: FENCE };
  const unit = beginOperation(core, bound, begin);
  const fragments = [];
  let predecessorHash: string | null = null;
  for (let index = 0; index < count; index += 1) {
    const effects: AtomicUnit = { guards: [], records: [], updates: [], relationships: [], barriers: [], purgeIntents: [], indexWrites: [],
      ...(index === count - 1 ? { moduleResult: { format: 'utf8' as const, data: 'complete-result' } } : {}),
      appends: [{ chainId: 'chain', record: { id: `r-${index}`, bytes: '{}', hash: `h-${index}` },
        expectation: index === 0 ? { kind: 'absent', allocation: '0' } : { kind: 'head', hash: `h-${index - 1}` } }],
    };
    const binding = { moduleId: 'comments' as const, scope: bound.scope, operationId: 'op', contractDigest: 'contract', sourceBoundary: 'source', ordinal: String(index), predecessorHash };
    const fragmentDigest = stagedFragmentDigest(binding, effects);
    stageOperationFragment(core, bound, { unit, ...binding, fragmentDigest, effects, fence: FENCE });
    fragments.push({ ordinal: String(index), fragmentDigest, effects });
    predecessorHash = fragmentDigest;
  }
  return { unit, root: { operationId: 'op', contractDigest: 'contract', sourceBoundary: 'source', finalFragmentHash: predecessorHash!, fragmentCount: String(count), ...stagedCommitRoots(fragments) } };
};
const limits = { maxRecords: 2, maxAppends: 1, maxEncodedBytes: 512 };

describe('bounded root sealing', () => {
  it('should prepare evolving heads across steps without publishing or replaying prior fragments', async () => {
    const fixture = stagedRootFixture();
    const { core, bound, coordinator } = fixture;
    const input = prepare(fixture, 6);
    const base = coordinator.capture(bound.scope);
    let result = sealOperationStep(core, bound, { ...input, limits, fence: FENCE });
    expect(result.state).toBe('validating');
    expect(coordinator.capture(bound.scope)).toBe(base);
    while (result.state === 'validating') {
      expect(result.work.items).toBeLessThanOrEqual(2);
      expect(result.work.appends).toBeLessThanOrEqual(1);
      expect(result.work.bytes).toBeLessThanOrEqual(512);
      result = sealOperationStep(core, bound, { ...input, limits, fence: FENCE });
    }
    expect(await bound.readHead('chain')).toBeNull();
    if (result.state !== 'sealed') throw new Error('expected seal');
    const reordered = Object.fromEntries(Object.entries(input.root).reverse()) as typeof input.root;
    expect(sealOperationStep(core, bound, { ...input, root: reordered, fence: FENCE })).toMatchObject({ state: 'sealed', seal: result.seal });
    const receipt = await commitSealedOperation(core, bound, { seal: result.seal, fence: FENCE });
    expect(receipt.moduleResult).toEqual({ format: 'utf8', data: 'complete-result' });
    expect(await bound.readHead('chain')).toBe('h-5');
    expect(core.data(core.current(bound.scope)).journal.length).toBe(1);
    expect(await commitSealedOperation(core, bound, { seal: result.seal, fence: FENCE })).toEqual(receipt);
  });

  it('should keep a failed sealing operation frozen and preserve the captured root', () => {
    const fixture = stagedRootFixture();
    const input = prepare(fixture);
    const bad = { ...input, root: { ...input.root, effectRoot: 'wrong' }, fence: FENCE };
    expect(() => { let result; do { result = sealOperationStep(fixture.core, fixture.bound, bad); } while (result.state === 'validating'); }).toThrow();
    expect(inspectOperation(fixture.core, fixture.bound, 'op').state).toBe('sealing');
    expect(() => sealOperationStep(fixture.core, fixture.bound, { ...input, fence: FENCE })).toThrow();
    abortOperation(fixture.core, fixture.bound, { unit: input.unit, fence: FENCE, reason: 'invalid source' });
    expect(inspectOperation(fixture.core, fixture.bound, 'op')).toEqual({ state: 'aborted', reason: 'invalid source' });
  });
});
