import { describe, expect, it } from 'vitest';
import { admitSpeech, markSpeechDispatched, SPEECH_CAMPAIGN_MICRO_USD, SPEECH_DAILY_MICRO_USD } from '../src/speech/admission.js';
import { operation, price, SpeechLedgerFixture } from './fixtures/speech-ledger.js';

describe('speech admission', () => {
  it('should atomically refuse concurrent reservations exceeding the aggregate daily cap', async () => {
    const ledger = new SpeechLedgerFixture();
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => admitSpeech(ledger.options(), operation(`op-${i}`))));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(5);
    expect(ledger.state.campaign.reservedMicroUsd).toBe(SPEECH_DAILY_MICRO_USD);
    await expect(admitSpeech(ledger.options(), operation('next'))).rejects.toMatchObject({ code: 'cap' });
  });

  it('should retain the total campaign cap across UTC days, account/provider switches and restart', async () => {
    let ledger = new SpeechLedgerFixture();
    for (let day = 0; day < 4; day++) {
      for (let call = 0; call < 5; call++) {
        const op = { ...operation(`${day}-${call}`), binding: { ...operation().binding,
          providerId: `provider-${day}`, modelId: `model-${day}`, accountRef: `account-${call}` } };
        ledger.currentPrice = price(op);
        await admitSpeech(ledger.options(), op);
      }
      const next = new SpeechLedgerFixture();
      next.restore(ledger.bytes());
      next.nowMs = ledger.nowMs + 86_400_000;
      ledger = next;
    }
    expect(ledger.state.campaign.reservedMicroUsd).toBe(SPEECH_CAMPAIGN_MICRO_USD);
    await expect(admitSpeech(ledger.options(), operation('fifth-day'))).rejects.toMatchObject({ code: 'cap' });
  });

  it('should never raise the owner ceilings through host overrides and should honor tighter envelopes', async () => {
    const ledger = new SpeechLedgerFixture();
    for (let i = 0; i < 5; i++) await admitSpeech({ ...ledger.options(), dailyCapMicroUsd: 100_000_000 }, operation(`${i}`));
    await expect(admitSpeech({ ...ledger.options(), dailyCapMicroUsd: 100_000_000 }, operation('sixth')))
      .rejects.toMatchObject({ code: 'cap' });
    const tight = new SpeechLedgerFixture();
    await expect(admitSpeech({ ...tight.options(), campaignCapMicroUsd: 500_000 }, operation()))
      .rejects.toMatchObject({ code: 'cap' });
  });

  it('should recover the same reservation and dispatch only once after restart', async () => {
    const ledger = new SpeechLedgerFixture();
    const hold = await admitSpeech(ledger.options(), operation());
    const restarted = new SpeechLedgerFixture();
    restarted.restore(ledger.bytes());
    expect(await admitSpeech(restarted.options(), operation())).toEqual(hold);
    expect(restarted.state.campaign.reservedMicroUsd).toBe(1_000_000);
    expect(await markSpeechDispatched(restarted.options(), 'stt-1')).toBe(true);
    expect(await markSpeechDispatched(restarted.options(), 'stt-1')).toBe(false);
    await expect(admitSpeech(restarted.options(), { ...operation(), attemptId: 'retry' }))
      .rejects.toMatchObject({ code: 'conflict' });
  });

  it('should refuse missing, foreign or mismatched allocator admissions', async () => {
    for (const patch of [{ receiptRef: 'other' }, { tenantId: 'other' }, { principalId: 'other' },
      { workspaceId: 'other' }, { targetSessionId: 'other' }, { nativeTurnRef: 'other' },
      { submitKey: 'other' }, { coordinatorEpoch: 2 }, { backendOperationRef: 'other' }]) {
      const ledger = new SpeechLedgerFixture();
      Object.assign(ledger.state.allocator, patch);
      await expect(admitSpeech(ledger.options(), operation())).rejects.toMatchObject({ code: 'allocator' });
      expect(ledger.state.campaign.reservedMicroUsd).toBe(0);
    }
  });

  it('should fail closed before open when durable accounting or pricing is unavailable', async () => {
    const ledger = new SpeechLedgerFixture();
    await expect(admitSpeech({ campaignRef: 'campaign' }, operation())).rejects.toMatchObject({ code: 'unavailable' });
    ledger.unavailable = true;
    await expect(admitSpeech(ledger.options(), operation())).rejects.toThrow('Speech accounting refused: unavailable');
    ledger.unavailable = false;
    ledger.currentPrice = undefined;
    await expect(admitSpeech(ledger.options(), operation())).rejects.toMatchObject({ code: 'unavailable' });
    ledger.currentPrice = { ...price(), expiresAtMs: ledger.nowMs };
    await expect(admitSpeech(ledger.options(), operation())).rejects.toMatchObject({ code: 'unavailable' });
    expect(Object.keys(ledger.state.holds)).toHaveLength(0);
  });

  it('should enforce finite duration, concurrency and pre-dispatch ledger acknowledgement', async () => {
    const ledger = new SpeechLedgerFixture();
    await expect(admitSpeech(ledger.options(), { ...operation(), maxDurationMs: Infinity })).rejects.toMatchObject({ code: 'invalid' });
    await admitSpeech(ledger.options(), { ...operation(), maxConcurrent: 1 });
    await expect(admitSpeech(ledger.options(), { ...operation('second'), maxConcurrent: 1 })).rejects.toMatchObject({ code: 'concurrency' });
    ledger.unavailable = true;
    await expect(markSpeechDispatched(ledger.options(), 'stt-1')).rejects.toMatchObject({ code: 'unavailable' });
    expect(ledger.state.holds['stt-1'].dispatched).toBe(false);
    ledger.unavailable = false;
    ledger.nowMs += 60_000;
    await expect(markSpeechDispatched(ledger.options(), 'stt-1')).rejects.toMatchObject({ code: 'expired' });
    expect(ledger.state.campaign.reservedMicroUsd).toBe(1_000_000);
  });

  it('should refuse a connection crossing UTC midnight and keep old unresolved liability on its original day', async () => {
    const ledger = new SpeechLedgerFixture();
    ledger.nowMs = Date.parse('2026-10-27T23:59:30Z');
    await expect(admitSpeech(ledger.options(), operation())).rejects.toMatchObject({ code: 'invalid' });
    const bounded = { ...operation(), maxDurationMs: 30_000,
      ceiling: { connectedSeconds: 30, admittedAudioSeconds: 30 } };
    await admitSpeech(ledger.options(), bounded);
    ledger.nowMs += 30_000;
    await expect(markSpeechDispatched(ledger.options(), 'stt-1')).rejects.toMatchObject({ code: 'expired' });
    await admitSpeech(ledger.options(), operation('new-day'));
    expect(ledger.state.days['2026-10-27'].reservedMicroUsd).toBe(500_000);
    expect(ledger.state.days['2026-10-28'].reservedMicroUsd).toBe(1_000_000);
    expect(ledger.state.campaign.reservedMicroUsd).toBe(1_500_000);
  });

  it('should snapshot the campaign and operation before awaiting storage', async () => {
    const ledger = new SpeechLedgerFixture();
    const options = ledger.options();
    const op = operation();
    const pending = admitSpeech(options, op);
    Object.assign(options, { campaignRef: 'caller-supplied-campaign' });
    Object.assign(op.ceiling, { connectedSeconds: 1 });
    const hold = await pending;
    expect(hold.campaignRef).toBe('owner-campaign');
    expect(hold.operation.ceiling.connectedSeconds).toBe(60);
  });

  it('should refuse payloads in operational metadata and pin price identity and all priced ceilings', async () => {
    const ledger = new SpeechLedgerFixture();
    await expect(admitSpeech(ledger.options(), { ...operation(), audio: new Uint8Array(8) } as never))
      .rejects.toMatchObject({ code: 'invalid' });
    await expect(admitSpeech(ledger.options(), { ...operation(), binding: { ...operation().binding, transcript: 'private' } } as never))
      .rejects.toMatchObject({ code: 'invalid' });
    ledger.currentPrice = { ...price(), modelId: 'different-model' };
    await expect(admitSpeech(ledger.options(), operation())).rejects.toMatchObject({ code: 'unavailable' });
    ledger.currentPrice = { ...price(), rates: { ...price().rates, audioOutputTokens: { microUsd: 1, per: 1 } } };
    await expect(admitSpeech(ledger.options(), operation())).rejects.toMatchObject({ code: 'unavailable' });
    expect(ledger.state.campaign.reservedMicroUsd).toBe(0);
  });
});
