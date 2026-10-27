import type { SpeechAccountingOptions, SpeechAllocatorReceipt, SpeechBudgetSnapshot, SpeechHold,
  SpeechLedgerPort, SpeechLedgerTransaction, SpeechOperation } from '../../src/speech/admission.js';
import type { SpeechSettlementEntry } from '../../src/speech/settlement.js';
import type { SpeechPrice } from '../../src/speech/usage.js';

export const instant = Date.parse('2026-10-27T12:00:00Z');
export const operation = (operationId = 'stt-1'): SpeechOperation => ({
  operationId, sessionId: 'speech-session', attemptId: operationId, backendOperationRef: 'agent-ledger-op',
  nativeTurnRef: 'native-turn', submitKey: 'submit-1', coordinatorEpoch: 1, allocatorReceiptRef: 'allocator-1', stage: 'stt',
  cost: { tenantId: 'tenant', workspaceId: 'workspace', principalId: 'principal', source: 'h2a-voice', correlationId: 'corr' },
  binding: { providerId: 'provider-a', modelId: 'model-a', modelRevision: 'model-r1', adapterId: 'adapter',
    adapterRevision: 'adapter-r1', placement: 'cloud-relay', accountRef: 'redacted-account', region: 'region-a' },
  configuration: { profileId: 'cloud-stt', configRevision: 'config-r1', policyRef: 'policy' },
  target: { sessionId: 'agent-session', sourceGeneration: 'boot-1', controllerEpoch: 1, consentRevision: 'consent-1' },
  ceiling: { connectedSeconds: 60, admittedAudioSeconds: 60 }, maxDurationMs: 60_000, maxConcurrent: 20,
});
export const price = (op = operation()): SpeechPrice => ({
  providerId: op.binding.providerId, modelId: op.binding.modelId, region: op.binding.region,
  currency: 'USD', revision: 'price-r1', effectiveAtMs: instant - 1, expiresAtMs: instant + 86_400_000 * 10,
  rates: { connectedSeconds: { microUsd: 1_000_000, per: 60 }, admittedAudioSeconds: { microUsd: 0, per: 1 } },
  fixedMicroUsd: 0,
});
const emptyBudget = (): SpeechBudgetSnapshot => ({ spentMicroUsd: 0, reservedMicroUsd: 0 });
interface State {
  holds: Record<string, SpeechHold>; days: Record<string, SpeechBudgetSnapshot>; campaign: SpeechBudgetSnapshot;
  entries: SpeechSettlementEntry[]; allocator: SpeechAllocatorReceipt;
}
/** Test transaction fixture only: models existing owner rows, rollback and durable-byte restart. */
export class SpeechLedgerFixture implements SpeechLedgerPort {
  readonly durability = 'durable' as const;
  unavailable = false; failAppend = false;
  nowMs = instant;
  currentPrice: SpeechPrice | undefined = price();
  state: State = { holds: {}, days: {}, campaign: emptyBudget(), entries: [], allocator: {
    receiptRef: 'allocator-1', tenantId: 'tenant', workspaceId: 'workspace', principalId: 'principal',
    targetSessionId: 'agent-session', nativeTurnRef: 'native-turn', submitKey: 'submit-1', coordinatorEpoch: 1, countedUnits: 1,
    backendOperationRef: 'agent-ledger-op',
  } };
  private queue: Promise<unknown> = Promise.resolve();
  options(): SpeechAccountingOptions { return { campaignRef: 'owner-campaign', ledger: this, now: () => this.nowMs }; }
  bytes(): string { return JSON.stringify(this.state); }
  restore(bytes: string): void { this.state = JSON.parse(bytes) as State; }
  async transaction<T>(change: (tx: SpeechLedgerTransaction) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      if (this.unavailable) throw new Error('private storage outage');
      const draft = structuredClone(this.state);
      const tx: SpeechLedgerTransaction = {
        lock: async () => undefined, // The fixture queue serializes; production uses owner DB locks.
        getHold: async id => Object.hasOwn(draft.holds, id) ? structuredClone(draft.holds[id]) : undefined,
        putHold: async hold => { Object.defineProperty(draft.holds, hold.operation.operationId, {
          value: structuredClone(hold), enumerable: true, configurable: true, writable: true }); },
        budgets: async (_campaign, day) => ({ daily: draft.days[day] ?? emptyBudget(), campaign: draft.campaign }),
        adjustBudgets: async (_campaign, day, reservedDelta, spentDelta) => {
          const adjust = (b: SpeechBudgetSnapshot) => ({ spentMicroUsd: b.spentMicroUsd + spentDelta,
            reservedMicroUsd: b.reservedMicroUsd + reservedDelta });
          draft.days[day] = adjust(draft.days[day] ?? emptyBudget());
          draft.campaign = adjust(draft.campaign);
        },
        allocatorReceipt: async ref => ref === draft.allocator.receiptRef ? structuredClone(draft.allocator) : undefined,
        price: async () => structuredClone(this.currentPrice),
        activeConnections: async (account, at) => Object.values(draft.holds).filter(h => h.state === 'reserved'
          && h.operation.binding.accountRef === account && h.expiresAtMs > at).length,
        appendSettlement: async entry => {
          if (this.failAppend) throw new Error('private ledger write failure');
          if (draft.entries.some(e => e.entryRef === entry.entryRef)) throw new Error('duplicate financial row');
          draft.entries.push(structuredClone(entry));
        },
      };
      const result = await change(tx);
      this.state = draft;
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
