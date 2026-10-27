import { describe, expect, it } from 'vitest';
import { admitSpeech, markSpeechDispatched } from '../src/speech/admission.js';
import { recordSpeechUsage, releaseSpeech, settleSpeech } from '../src/speech/settlement.js';
import { operation, SpeechLedgerFixture } from './fixtures/speech-ledger.js';

const dispatched = async () => {
  const ledger = new SpeechLedgerFixture();
  await admitSpeech(ledger.options(), operation());
  await markSpeechDispatched(ledger.options(), 'stt-1');
  return ledger;
};
const final = { operationId: 'stt-1', providerRevision: 1, outcome: 'cancelled' as const,
  usage: { connectedSeconds: 30, admittedAudioSeconds: 20 } };

describe('speech settlement', () => {
  it('should reserve uncertain spend as one estimate and apply signed true-ups once across restart', async () => {
    const ledger = await dispatched();
    expect(await settleSpeech(ledger.options(), { operationId: 'stt-1', outcome: 'unknown' })).toBe(true);
    expect(ledger.state.campaign).toEqual({ reservedMicroUsd: 0, spentMicroUsd: 1_000_000 });
    const restarted = new SpeechLedgerFixture();
    restarted.restore(ledger.bytes());
    expect(await settleSpeech(restarted.options(), { operationId: 'stt-1', outcome: 'unknown' })).toBe(false);
    expect(await settleSpeech(restarted.options(), final)).toBe(true);
    expect(await settleSpeech(restarted.options(), final)).toBe(false);
    expect(restarted.state.campaign.spentMicroUsd).toBe(500_000);
    expect(restarted.state.entries.map(e => e.deltaMicroUsd)).toEqual([1_000_000, -500_000]);
    expect(restarted.state.entries[1].rootEntryRef).toBe(restarted.state.entries[0].entryRef);
    await settleSpeech(restarted.options(), { ...final, providerRevision: 2,
      usage: { connectedSeconds: 45, admittedAudioSeconds: 20 } });
    expect(restarted.state.entries[2].deltaMicroUsd).toBe(250_000);
    expect(restarted.state.campaign.spentMicroUsd).toBe(750_000);
    expect(await settleSpeech(restarted.options(), final)).toBe(false);
  });

  it('should settle complete usage directly and reject a conflicting final revision', async () => {
    const ledger = await dispatched();
    await settleSpeech(ledger.options(), final);
    expect(ledger.state.entries[0].kind).toBe('final');
    expect(ledger.state.entries[0].outcome).toBe('cancelled');
    expect(ledger.state.entries[0].costMicroUsd).toBe(500_000);
    await expect(settleSpeech(ledger.options(), { ...final, usage: { connectedSeconds: 40, admittedAudioSeconds: 20 } }))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(ledger.state.entries).toHaveLength(1);
  });

  it('should retain missing dimensions as an estimate even if other dimensions are measured', async () => {
    const ledger = await dispatched();
    await recordSpeechUsage(ledger.options(), 'stt-1', { eventId: 'e', revision: 1, mode: 'cumulative',
      usage: { admittedAudioSeconds: 10 } });
    await settleSpeech(ledger.options(), { ...final, usage: { admittedAudioSeconds: 10 } });
    expect(ledger.state.entries[0]).toMatchObject({ kind: 'estimate', uncertain: true, costMicroUsd: 1_000_000 });
    expect(ledger.state.holds['stt-1'].usage?.totals.connectedSeconds).toBeUndefined();
    expect(await releaseSpeech(ledger.options(), 'stt-1')).toBe(false);
  });

  it('should retain the full reservation when settlement storage fails and retry without duplicate charge', async () => {
    const ledger = await dispatched();
    ledger.failAppend = true;
    await expect(settleSpeech(ledger.options(), final)).rejects.toMatchObject({ code: 'unavailable' });
    expect(ledger.state.campaign).toEqual({ reservedMicroUsd: 1_000_000, spentMicroUsd: 0 });
    expect(ledger.state.entries).toHaveLength(0);
    ledger.failAppend = false;
    await Promise.all([settleSpeech(ledger.options(), final), settleSpeech(ledger.options(), final)]);
    expect(ledger.state.entries).toHaveLength(1);
    expect(ledger.state.campaign.spentMicroUsd).toBe(500_000);
  });

  it('should link both speech operations to the existing allocator unit without counting the backend twice', async () => {
    const ledger = await dispatched();
    await admitSpeech(ledger.options(), { ...operation('tts-1'), stage: 'tts' });
    await markSpeechDispatched(ledger.options(), 'tts-1');
    await settleSpeech(ledger.options(), final);
    await settleSpeech(ledger.options(), { ...final, operationId: 'tts-1' });
    expect(ledger.state.entries.every(e => e.operation.allocatorReceiptRef === ledger.state.allocator.receiptRef)).toBe(true);
    expect(ledger.state.entries.every(e => e.operation.backendOperationRef === 'agent-ledger-op')).toBe(true);
    expect(ledger.state.entries.reduce((sum, e) => sum + e.countedUnitDelta, ledger.state.allocator.countedUnits)).toBe(1);
  });

  it('should release a never-opened connection once and keep a marked connection charged', async () => {
    const ledger = new SpeechLedgerFixture();
    await admitSpeech(ledger.options(), operation());
    expect(await releaseSpeech(ledger.options(), 'stt-1')).toBe(true);
    expect(await releaseSpeech(ledger.options(), 'stt-1')).toBe(false);
    expect(await markSpeechDispatched(ledger.options(), 'stt-1')).toBe(false);
    expect(ledger.state.campaign).toEqual({ reservedMicroUsd: 0, spentMicroUsd: 0 });
    const marked = await dispatched();
    expect(await releaseSpeech(marked.options(), 'stt-1')).toBe(false);
    await settleSpeech(marked.options(), { operationId: 'stt-1', outcome: 'failed' });
    expect(marked.state.campaign.spentMicroUsd).toBe(1_000_000);
  });

  it('should roll back the appended financial entry and budget change if closing the hold fails', async () => {
    const ledger = await dispatched();
    const before = ledger.bytes();
    ledger.failPut = true;
    await expect(settleSpeech(ledger.options(), final)).rejects.toMatchObject({ code: 'unavailable' });
    expect(ledger.bytes()).toBe(before);
    ledger.failPut = false;
    expect(await settleSpeech(ledger.options(), final)).toBe(true);
    expect(ledger.state.entries).toHaveLength(1);
  });

  it('should conservatively charge partial overrun evidence and never drop billed discarded output', async () => {
    const ledger = await dispatched();
    await settleSpeech(ledger.options(), { operationId: 'stt-1', outcome: 'unknown' });
    const partial = { eventId: 'usage', revision: 1, mode: 'cumulative' as const, usage: { connectedSeconds: 90 } };
    await recordSpeechUsage(ledger.options(), 'stt-1', partial);
    expect(await settleSpeech(ledger.options(), { operationId: 'stt-1', outcome: 'cancelled' })).toBe(true);
    expect(ledger.state.campaign.spentMicroUsd).toBe(1_500_000);
    expect(ledger.state.entries[1]).toMatchObject({ kind: 'adjustment', uncertain: true, overrun: true, deltaMicroUsd: 500_000 });
    expect(await settleSpeech(ledger.options(), { operationId: 'stt-1', outcome: 'cancelled' })).toBe(false);
    await settleSpeech(ledger.options(), { ...final, usage: { connectedSeconds: 90, admittedAudioSeconds: 10 } });
    expect(ledger.state.entries[2]).toMatchObject({ kind: 'adjustment', uncertain: false, deltaMicroUsd: 0 });
    await expect(settleSpeech(ledger.options(), { ...final, outcome: 'completed',
      usage: { connectedSeconds: 90, admittedAudioSeconds: 10 } })).rejects.toMatchObject({ code: 'conflict' });
  });
});
