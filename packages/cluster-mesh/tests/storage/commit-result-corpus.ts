import { expect } from 'vitest';
import type { AtomicUnit, CommitReceipt } from '../../src/storage/atomic.js';
import type { EncodedValue } from '../../src/storage/contracts.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';

export const recoveryIdentity = 'original-intent';
// These are opaque module bytes, including the original time and epoch.
export const originalModuleResult: EncodedValue = {
  format: 'utf8',
  data: '{"receipt":"original","committed_at":"2026-10-23T12:34:56.789Z","storage_epoch":"1","value":"🌍"}',
};
export const recoveryUnit = (): AtomicUnit => ({
  ...emptyEffects(),
  records: [{ key: 'original-record', contentHash: 'original-hash', bytes: { format: 'utf8', data: 'original' } }],
  moduleResult: { ...originalModuleResult },
});

export interface CommitResultFixture {
  commit(unit: AtomicUnit, identity: string): Promise<CommitReceipt>;
  recover(identity: string): Promise<EncodedValue | null>;
}

export const runCommitResultCorpus = async (fixture: CommitResultFixture): Promise<void> => {
  expect(await fixture.recover('absent')).toBeNull();
  const input = recoveryUnit();
  const committed = await fixture.commit(input, recoveryIdentity);
  expect(committed.moduleResult).toEqual(originalModuleResult);
  Object.assign(input.moduleResult!, { data: 'caller mutation' });
  const recovered = await fixture.recover(recoveryIdentity);
  expect(recovered).toEqual(originalModuleResult);
  Object.assign(recovered!, { data: 'reader mutation' });
  expect(await fixture.recover(recoveryIdentity)).toEqual(originalModuleResult);
  expect(await fixture.commit(recoveryUnit(), recoveryIdentity)).toEqual(committed);
  await expect(fixture.commit({ ...recoveryUnit(), moduleResult: { format: 'utf8', data: 'conflicting intent' } }, recoveryIdentity))
    .rejects.toMatchObject({ code: 'idempotency-conflict' });
  expect(await fixture.recover(recoveryIdentity)).toEqual(originalModuleResult);
};
