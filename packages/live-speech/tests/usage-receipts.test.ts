import { describe, expect, it } from 'vitest';
import { UsageReceipts } from '../src/core/usage-receipts.js';
import type { UsageEntry } from '../src/core/usage-receipts.js';
import { commit, fixture, scope } from './fixtures.js';

const entry = (revision = 0): UsageEntry => ({
  operationId: 'operation-1', attemptId: 'attempt-1', scope, turnEpoch: 1, submitKey: 'speech-1:source-1:1:1',
  nativeTurnId: 'native-1', routeRef: 'route-1', seatRef: 'seat-1', allocatorReceiptRef: 'admission-1',
  configurationRef: 'profile@revision', engineRef: 'local:model@sha256', placement: 'endpoint-native',
  revision, kind: revision === 0 ? 'estimate' : 'adjustment', estimateRef: revision ? 'operation-1:0' : undefined,
  countedUnitDelta: revision ? 0 : 1, capturedSeconds: 1, admittedSeconds: 1, localComputeMs: 50,
  externalSpeechUsd: 0, backendSpendUsd: null, backendTokens: null, outcome: 'cancelled',
  settlement: revision ? 'settled' : 'pending', signature: 'signed-receipt',
});

const admitted = async () => {
  const f = fixture();
  await f.core.send(await commit(f.core));
  return f.journal;
};

describe('operational usage journal', () => {
  it('should dedupe estimates and signed adjustments across restart without a second charge', async () => {
    const persisted: UsageEntry[] = [];
    const store = { transact: async <T>(change: (entries: UsageEntry[]) => T) => change(persisted) };
    const verify = async () => true;
    const turns = await admitted();
    const usage = new UsageReceipts(store, verify, turns);
    expect(await usage.record(entry())).toBe(true);
    expect(await usage.record(entry())).toBe(false);
    const adjustment = { ...entry(1), externalSpeechUsd: -0.01 };
    expect(await usage.record(adjustment)).toBe(true);
    const restarted = new UsageReceipts(store, verify, turns.restart());
    expect(await restarted.record(adjustment)).toBe(false);
    expect(persisted).toHaveLength(2);
    expect(persisted.reduce((sum, e) => sum + e.countedUnitDelta, 0)).toBe(1);
  });

  it('should reject unverified, unpaired, conflicting and payload-bearing receipts', async () => {
    const entries: UsageEntry[] = [];
    const store = { transact: async <T>(change: (rows: UsageEntry[]) => T) => change(entries) };
    const usage = new UsageReceipts(store, async e => e.signature === 'signed-receipt', await admitted());
    await expect(usage.record(entry(1))).rejects.toThrow('estimate');
    await expect(usage.record({ ...entry(), signature: 'forged' })).rejects.toThrow('signature');
    await expect(usage.record({ ...entry(), audio: new Uint8Array(2) } as UsageEntry)).rejects.toThrow('field');
    await expect(usage.record({ ...entry(), nativeTurnId: new Uint8Array(2) } as unknown as UsageEntry)).rejects.toThrow('identity');
    await usage.record(entry());
    await expect(usage.record({ ...entry(), capturedSeconds: 2 })).rejects.toThrow('conflict');
    await expect(usage.record({ ...entry(1), attemptId: 'other' })).rejects.toThrow('identity');
    await expect(usage.record({ ...entry(1), countedUnitDelta: 1 })).rejects.toThrow('delta');
    expect(entries).toHaveLength(1);
  });

  it('should count an allocator admission once across operations and persisted replay', async () => {
    let bytes = '[]';
    const store = { transact: async <T>(change: (rows: UsageEntry[]) => T) => {
      const rows = JSON.parse(bytes) as UsageEntry[];
      const result = change(rows);
      bytes = JSON.stringify(rows);
      return result;
    } };
    const turns = await admitted();
    const usage = new UsageReceipts(store, async () => true, turns);
    await expect(usage.record({ ...entry(), countedUnitDelta: 2 })).rejects.toThrow('delta');
    await usage.record(entry());
    const restarted = new UsageReceipts(store, async () => true, turns.restart());
    expect(await restarted.record(entry())).toBe(false);
    const replay = { ...entry(), operationId: 'operation-2' };
    await expect(restarted.record(replay)).rejects.toThrow('already counted');
    expect(await restarted.record({ ...replay, countedUnitDelta: 0 })).toBe(true);
    expect((JSON.parse(bytes) as UsageEntry[]).reduce((sum, e) => sum + e.countedUnitDelta, 0)).toBe(1);
    await expect(restarted.record({ ...entry(), operationId: 'operation-3', submitKey: 'forged' })).rejects.toThrow('turn');
    await expect(restarted.record({ ...entry(), operationId: 'operation-3', nativeTurnId: 'other' })).rejects.toThrow('native turn');
  });
});
