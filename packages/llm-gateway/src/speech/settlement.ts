import { sameSpeechIdentity, speechTransaction, SpeechAccountingError, utcSpeechDay,
  type SpeechAccountingOptions, type SpeechOperation } from './admission.js';
import { normalizeSpeechUsage, priceSpeechUsage, validateSpeechUsage,
  type SpeechUsage, type SpeechUsageUpdate } from './usage.js';

export interface SpeechSettlementEntry {
  readonly entryRef: string; readonly operation: SpeechOperation; readonly campaignRef: string; readonly utcDay: string;
  readonly kind: 'estimate' | 'final' | 'adjustment'; readonly rootEntryRef?: string;
  readonly revision: number; readonly providerRevision?: number; readonly pricingRevision: string;
  readonly costMicroUsd: number; readonly deltaMicroUsd: number; readonly uncertain: boolean;
  readonly usage?: SpeechUsage; readonly countedUnitDelta: 0;
  readonly outcome: 'completed' | 'cancelled' | 'failed' | 'unknown'; readonly overrun: boolean;
}
export interface SpeechSettlementRequest {
  readonly operationId: string; readonly usage?: SpeechUsage; readonly providerRevision?: number;
  readonly outcome: SpeechSettlementEntry['outcome'];
}

/** Usage updates are operational evidence on the existing hold; they never charge or allocate units. */
export const recordSpeechUsage = async (options: SpeechAccountingOptions, operationId: string,
  input: SpeechUsageUpdate): Promise<void> => {
  const update = structuredClone(input);
  await speechTransaction(options, async (tx, nowMs, campaignRef) => {
    await tx.lock(campaignRef, operationId, utcSpeechDay(nowMs));
    const hold = await tx.getHold(operationId);
    if (!hold || hold.campaignRef !== campaignRef || !hold.dispatched || hold.state === 'settled') {
      throw new SpeechAccountingError('invalid');
    }
    hold.usage = normalizeSpeechUsage(hold.usage, update);
    await tx.putHold(hold);
  });
};

/** Missing final usage consumes the conservative hold, never zero. Adjustments debit only the difference. */
export const settleSpeech = async (options: SpeechAccountingOptions, input: SpeechSettlementRequest): Promise<boolean> => {
  const request = structuredClone(input);
  if (!request.operationId || !['completed', 'cancelled', 'failed', 'unknown'].includes(request.outcome)) {
    throw new SpeechAccountingError('invalid');
  }
  if (request.usage) validateSpeechUsage(request.usage);
  return speechTransaction(options, async (tx, nowMs, campaignRef) => {
    await tx.lock(campaignRef, request.operationId, utcSpeechDay(nowMs));
    const hold = await tx.getHold(request.operationId);
    if (!hold || hold.campaignRef !== campaignRef || !hold.dispatched) throw new SpeechAccountingError('invalid');
    const complete = request.usage !== undefined
      && Object.keys(hold.price.rates).every(key => request.usage![key as keyof SpeechUsage] !== undefined);
    if (complete && (!Number.isSafeInteger(request.providerRevision) || request.providerRevision! < 0)) {
      throw new SpeechAccountingError('invalid');
    }
    if (!complete && hold.state !== 'reserved') return false;
    if (complete && hold.providerRevision !== undefined && request.providerRevision! <= hold.providerRevision) {
      if (request.providerRevision === hold.providerRevision
        && !sameSpeechIdentity(request.usage, hold.settledUsage)) throw new SpeechAccountingError('conflict');
      return false;
    }
    const observedCost = request.usage ? priceSpeechUsage(hold.price, request.usage) : 0;
    const costMicroUsd = complete ? observedCost : Math.max(hold.liabilityMicroUsd, observedCost);
    const revision = hold.settlementRevision + 1;
    const kind = hold.rootEntryRef ? 'adjustment' : complete ? 'final' : 'estimate';
    const entryRef = JSON.stringify([request.operationId, kind, revision]);
    const overrun = costMicroUsd > hold.liabilityMicroUsd || Object.entries(request.usage ?? {}).some(([key, value]) =>
      hold.operation.ceiling[key as keyof SpeechUsage] !== undefined && value > hold.operation.ceiling[key as keyof SpeechUsage]!);
    const entry: SpeechSettlementEntry = { entryRef, operation: hold.operation, campaignRef: hold.campaignRef,
      utcDay: hold.utcDay, kind, ...(hold.rootEntryRef ? { rootEntryRef: hold.rootEntryRef } : {}), revision,
      ...(complete ? { providerRevision: request.providerRevision } : {}), pricingRevision: hold.price.revision,
      costMicroUsd, deltaMicroUsd: costMicroUsd - hold.chargedMicroUsd, uncertain: !complete,
      ...(request.usage ? { usage: request.usage } : {}), countedUnitDelta: 0, outcome: request.outcome, overrun };
    await tx.appendSettlement(entry);
    await tx.adjustBudgets(hold.campaignRef, hold.utcDay,
      hold.state === 'reserved' ? -hold.liabilityMicroUsd : 0, entry.deltaMicroUsd);
    hold.rootEntryRef ??= entryRef;
    hold.chargedMicroUsd = costMicroUsd;
    hold.settlementRevision = revision;
    hold.state = complete ? 'settled' : 'estimated';
    if (complete) { hold.providerRevision = request.providerRevision; hold.settledUsage = request.usage; }
    await tx.putHold(hold);
    return true;
  });
};

/** Only a never-dispatched hold may be released for zero; Stop itself needs no new admission. */
export const releaseSpeech = async (options: SpeechAccountingOptions, operationId: string): Promise<boolean> =>
  speechTransaction(options, async (tx, nowMs, campaignRef) => {
    await tx.lock(campaignRef, operationId, utcSpeechDay(nowMs));
    const hold = await tx.getHold(operationId);
    if (!hold || hold.campaignRef !== campaignRef) throw new SpeechAccountingError('invalid');
    if (hold.dispatched || hold.state !== 'reserved') return false;
    await tx.adjustBudgets(hold.campaignRef, hold.utcDay, -hold.liabilityMicroUsd, 0);
    hold.state = 'settled';
    await tx.putHold(hold);
    return true;
  });
