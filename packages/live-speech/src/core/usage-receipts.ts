import { isValidScope, same, scopeFields } from './session.js';
import type { Scope } from './session.js';

export interface UsageEntry {
  operationId: string; attemptId: string; scope: Scope; turnEpoch: number; submitKey: string;
  nativeTurnId?: string; routeRef: string; seatRef: string; allocatorReceiptRef: string;
  configurationRef: string; engineRef: string; placement: string; revision: number;
  kind: 'estimate' | 'adjustment'; estimateRef?: string; countedUnitDelta: number;
  capturedSeconds: number; admittedSeconds: number; localComputeMs: number;
  externalSpeechUsd: number | null; backendSpendUsd: number | null; backendTokens: number | null;
  outcome: 'completed' | 'cancelled' | 'failed' | 'unknown'; settlement: 'pending' | 'settled'; signature: string;
}
export interface UsageJournal { transact<T>(change: (entries: UsageEntry[]) => T): Promise<T> }
const fields = ['operationId', 'attemptId', 'scope', 'turnEpoch', 'submitKey', 'nativeTurnId', 'routeRef',
  'seatRef', 'allocatorReceiptRef', 'configurationRef', 'engineRef', 'placement', 'revision', 'kind',
  'estimateRef', 'countedUnitDelta', 'capturedSeconds', 'admittedSeconds', 'localComputeMs',
  'externalSpeechUsd', 'backendSpendUsd', 'backendTokens', 'outcome', 'settlement', 'signature'];
const nonnegative = (value: number) => Number.isFinite(value) && value >= 0;

/** Operational receipts only. L8 binds reservations and settlement to the existing billing ledger. */
export class UsageReceipts {
  constructor(private readonly journal: UsageJournal,
    private readonly verifySignature: (entry: UsageEntry) => Promise<boolean>) {}

  async record(input: UsageEntry): Promise<boolean> {
    if (Object.keys(input).some(k => !fields.includes(k))
      || !input.scope || Object.keys(input.scope).some(k => !scopeFields.includes(k))) throw new Error('Unsupported receipt field');
    const entry = structuredClone(input);
    const refs = [entry.operationId, entry.attemptId, entry.submitKey, entry.routeRef, entry.seatRef,
      entry.allocatorReceiptRef, entry.configurationRef, entry.engineRef, entry.placement, entry.signature];
    if (refs.some(v => typeof v !== 'string' || !v)
      || (entry.nativeTurnId !== undefined && (typeof entry.nativeTurnId !== 'string' || !entry.nativeTurnId))
      || !isValidScope(entry.scope)
      || !Number.isSafeInteger(entry.turnEpoch) || entry.turnEpoch < 1
      || !Number.isSafeInteger(entry.revision) || entry.revision < 0
      || !['estimate', 'adjustment'].includes(entry.kind)
      || !['completed', 'cancelled', 'failed', 'unknown'].includes(entry.outcome)
      || !['pending', 'settled'].includes(entry.settlement)
      || ![entry.capturedSeconds, entry.admittedSeconds, entry.localComputeMs].every(nonnegative)
      || [entry.externalSpeechUsd, entry.backendSpendUsd, entry.backendTokens].some(v => v !== null && !Number.isFinite(v))) {
      throw new Error('Invalid receipt dimensions or identity');
    }
    if (!Number.isSafeInteger(entry.countedUnitDelta) || entry.countedUnitDelta < 0
      || (entry.kind === 'adjustment' && entry.countedUnitDelta !== 0)) throw new Error('Invalid counted-unit delta');
    if (!await this.verifySignature(structuredClone(entry))) throw new Error('Invalid receipt signature');
    return this.journal.transact(entries => {
      const previous = entries.find(e => e.operationId === entry.operationId && e.revision === entry.revision);
      if (previous) {
        if (!same(previous, entry)) throw new Error('Receipt revision conflict');
        return false;
      }
      const estimate = entries.find(e => e.operationId === entry.operationId && e.kind === 'estimate');
      if (entry.kind === 'estimate') {
        if (estimate || entry.revision !== 0 || entry.estimateRef) throw new Error('One initial estimate required');
      } else {
        if (!estimate || !entry.revision || entry.estimateRef !== `${entry.operationId}:0`) throw new Error('Adjustment needs its estimate');
        const identity = (e: UsageEntry) => ({ scope: e.scope, attemptId: e.attemptId, turnEpoch: e.turnEpoch,
          submitKey: e.submitKey, nativeTurnId: e.nativeTurnId, routeRef: e.routeRef, seatRef: e.seatRef,
          allocatorReceiptRef: e.allocatorReceiptRef, configurationRef: e.configurationRef,
          engineRef: e.engineRef, placement: e.placement });
        if (!same(identity(estimate), identity(entry))) throw new Error('Operation identity mismatch');
      }
      entries.push(structuredClone(entry));
      return true;
    });
  }
}
