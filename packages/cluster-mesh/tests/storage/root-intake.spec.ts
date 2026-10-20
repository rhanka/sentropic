import { describe, expect, it } from 'vitest';
import { createStagedKernel } from '../../src/storage/index.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import { grantFor } from './authority-corpus.js';
import { FENCE } from './root-protocol-fixture.js';
import { stagedDigestOf } from './staged-corpus.js';

describe('staged intake admission', () => {
  it.each([
    ['invalid-record', { ...emptyEffects(), records: [{ key: 'record', contentHash: 'h', bytes: { format: 'utf8', data: 12 } }] }, 'invalid-command'],
    ['all-items', { ...emptyEffects(), guards: Array.from({ length: 129 }, (_, n) => ({ kind: 'absent', chainId: `guard-${n}` })), records: [{ key: 'record', contentHash: 'h', bytes: { format: 'utf8', data: '{}' } }] }, 'invalid-command'],
    ['forged-authorizer', { ...emptyEffects(), purgeIntents: [{ target: 'target', intentId: 'forged', authorizedBy: 'other-principal' }] }, 'denied'],
  ] as const)('should refuse %s before accepting an ordinal', async (key, malformed, code) => {
    const root = createStagedKernel({ moduleId: 'comments' });
    const bound = root.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
    root.provisionFence(bound.scope, bound.grant.principalId, FENCE);
    const unit = await bound.beginStaged({ operationKey: key, inputDigest: 'input', contractDigest: 'contract-k2b', sourceBoundary: 'boundary-k2b', fence: FENCE });
    const effects = malformed as unknown as AtomicUnit;
    await expect(bound.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: stagedDigestOf(unit, '0', null, effects), effects, fence: FENCE })).rejects.toMatchObject({ code });
    expect(await bound.inspectStaged(key)).toEqual({ state: 'staging', acceptedFragments: '0' });
    expect((await bound.journalRead('admission', 0, 100)).events).toEqual([]);
  });
});
