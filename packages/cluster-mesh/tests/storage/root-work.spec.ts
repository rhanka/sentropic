import { describe, expect, it, vi } from 'vitest';
import { MemoryBackend, createIndexedBackendScopeState } from '../../src/storage/backend.js';
import { createStagedKernel } from '../../src/storage/index.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import type { StagedControl } from '../../src/storage/staged-state.js';
import * as records from '../../src/storage/record-runtime.js';
import { grantFor } from './authority-corpus.js';
import { FENCE } from './root-protocol-fixture.js';
import { stagedDigestOf, stagedSealRoot } from './staged-corpus.js';

describe('measured bounded staged preparation', () => {
  it('should bound every step and publish without enumerating historical scopes or fragments', async () => {
    const backend = new MemoryBackend(createIndexedBackendScopeState);
    const root = createStagedKernel({ moduleId: 'comments', backend });
    const bound = root.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
    for (let n = 0; n < 300; n += 1) await bound.appendChain('history', { id: `old-${n}`, hash: `old-${n}`, bytes: '{}' }, n === 0 ? { kind: 'absent', allocation: '0' } : { kind: 'head', hash: `old-${n - 1}` });
    root.provisionFence(bound.scope, bound.grant.principalId, FENCE);
    const unit = await bound.beginStaged({ operationKey: 'bounded', inputDigest: 'input', contractDigest: 'contract-k2b', sourceBoundary: 'boundary-k2b', fence: FENCE });
    const fragments = [];
    let predecessorHash: string | null = null;
    for (let n = 0; n < 100; n += 1) {
      const effects = { ...emptyEffects(), appends: [{ chainId: `new-chain-${n}`, record: { id: `n-${n}`, hash: `h-${n}`, bytes: '{}' }, expectation: { kind: 'absent' as const, allocation: '0' } }] };
      const fragmentDigest = stagedDigestOf(unit, String(n), predecessorHash, effects);
      await bound.stageFragment({ unit, ordinal: String(n), predecessorHash, fragmentDigest, effects, fence: FENCE });
      predecessorHash = fragmentDigest; fragments.push(effects);
    }
    const base = backend.scopeState(bound.scope);
    base.chains.entries = () => { throw new Error('historical scope enumeration'); };
    base.chains.get('history')!.records.map = () => { throw new Error('historical chain enumeration'); };
    const original = records.prepareUnitsInScope;
    let effectsPrepared = 0;
    const prepare = vi.spyOn(records, 'prepareUnitsInScope').mockImplementation((state, units, context) => {
      effectsPrepared += units.reduce((sum, value) => sum + value.appends.length + value.records.length + value.updates.length + value.guards.length + value.indexWrites.length, 0);
      return original(state, units, context);
    });
    try {
      const input = { unit, root: stagedSealRoot(unit, fragments), fence: FENCE, limits: { maxRecords: 2, maxAppends: 1, maxEncodedBytes: 512 } };
      let outcome;
      do {
        const before = effectsPrepared;
        outcome = await bound.sealStep(input);
        expect(effectsPrepared - before).toBeLessThanOrEqual(2);
        expect(outcome.work.items).toBeLessThanOrEqual(2);
        expect(outcome.work.bytes).toBeLessThanOrEqual(512);
      } while (outcome.state === 'validating');
      expect(effectsPrepared).toBe(100);
      const control = backend.controlState<StagedControl>(bound.scope, 'staged-runtime-v1', () => { throw new Error('missing control'); });
      control.byId.get(unit.unitId)!.fragments[Symbol.iterator] = function* () { throw new Error('whole-unit replay at commit'); };
      const before = effectsPrepared;
      await bound.commitStaged({ seal: outcome.seal, fence: FENCE });
      expect(effectsPrepared).toBe(before);
      expect(await bound.readHead('new-chain-99')).toBe('h-99');
      expect((await bound.externalRead(300, 10)).events).toHaveLength(1);
    } finally { prepare.mockRestore(); }
  });
});
