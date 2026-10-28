import { sameSpeechIdentity, speechTransaction, SpeechAccountingError, utcSpeechDay,
  type SpeechAccountingOptions, type SpeechAllocatorReceipt, type SpeechHold, type SpeechOperation } from './admission.js';
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

export interface SpeechReconciliationRow {
  readonly operationId: string; readonly attemptId: string; readonly allocatorReceiptRef: string;
  readonly submitKey: string; readonly coordinatorEpoch: number; readonly entryRefs: readonly string[];
  readonly issues: readonly ('orphan-usage' | 'allocator-mismatch' | 'duplicate-allocator-receipt'
    | 'uncounted-admission' | 'duplicate-usage-receipt' | 'orphan-adjustment' | 'missing-usage')[];
}
/** L7 supplies a complete, consistent owner snapshot; this projection never writes or counts units. */
export const reconcileSpeech = (admissions: readonly SpeechHold[], allocatorReceipts: readonly SpeechAllocatorReceipt[],
  usageReceipts: readonly SpeechSettlementEntry[]): SpeechReconciliationRow[] => {
  const operationKey = (op: SpeechOperation): string => JSON.stringify([op.operationId, op.attemptId]);
  const allocatorIdentity = (op: SpeechOperation): Omit<SpeechAllocatorReceipt, 'countedUnits'> => ({
    receiptRef: op.allocatorReceiptRef, tenantId: op.cost.tenantId, workspaceId: op.cost.workspaceId,
    principalId: op.cost.principalId, targetSessionId: op.target.sessionId, nativeTurnRef: op.nativeTurnRef,
    submitKey: op.submitKey, coordinatorEpoch: op.coordinatorEpoch, backendOperationRef: op.backendOperationRef,
  });
  const turnKey = (r: SpeechAllocatorReceipt | Omit<SpeechAllocatorReceipt, 'countedUnits'>): string =>
    JSON.stringify([r.tenantId, r.workspaceId, r.principalId, r.targetSessionId, r.submitKey, r.coordinatorEpoch]);
  const nativeKey = (r: SpeechAllocatorReceipt | Omit<SpeechAllocatorReceipt, 'countedUnits'>): string | undefined =>
    r.nativeTurnRef === undefined ? undefined
      : JSON.stringify([r.tenantId, r.workspaceId, r.principalId, r.targetSessionId, r.nativeTurnRef]);
  const groups = new Map<string, { operation: SpeechOperation; admission?: SpeechHold; entries: SpeechSettlementEntry[] }>();
  for (const admission of admissions) {
    groups.set(operationKey(admission.operation), { operation: admission.operation, admission, entries: [] });
  }
  for (const entry of usageReceipts) {
    const key = operationKey(entry.operation);
    let group = groups.get(key);
    if (!group) {
      group = { operation: entry.operation, entries: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()].map(({ operation: op, admission, entries }) => {
    const issues: SpeechReconciliationRow['issues'][number][] = [];
    const expected = allocatorIdentity(op);
    const receipts = allocatorReceipts.filter(r => r.receiptRef === op.allocatorReceiptRef);
    if (!admission) issues.push('orphan-usage');
    if (receipts.length !== 1 || !sameSpeechIdentity({ ...expected, countedUnits: receipts[0]?.countedUnits }, receipts[0])
      || entries.some(e => !sameSpeechIdentity(e.operation, op))) issues.push('allocator-mismatch');
    if (allocatorReceipts.filter(r => turnKey(r) === turnKey(expected)
      || (nativeKey(expected) !== undefined && nativeKey(r) === nativeKey(expected))).length > 1) {
      issues.push('duplicate-allocator-receipt');
    }
    if (receipts.some(r => r.countedUnits === 0) && (admission?.dispatched || entries.length > 0)) {
      issues.push('uncounted-admission');
    }
    if (new Set(entries.map(e => e.entryRef)).size !== entries.length
      || entries.filter(e => e.kind !== 'adjustment').length > 1) issues.push('duplicate-usage-receipt');
    const roots = new Set(entries.filter(e => e.kind !== 'adjustment').map(e => e.entryRef));
    if (entries.some(e => e.kind === 'adjustment' && (!e.rootEntryRef || !roots.has(e.rootEntryRef)))) {
      issues.push('orphan-adjustment');
    }
    if (admission?.dispatched && admission.state !== 'reserved' && entries.length === 0) issues.push('missing-usage');
    return { operationId: op.operationId, attemptId: op.attemptId, allocatorReceiptRef: op.allocatorReceiptRef,
      submitKey: op.submitKey, coordinatorEpoch: op.coordinatorEpoch, entryRefs: entries.map(e => e.entryRef), issues };
  });
};

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
    if (!complete && hold.state === 'settled') return false;
    if (complete && hold.providerRevision !== undefined && request.providerRevision! <= hold.providerRevision) {
      if (request.providerRevision === hold.providerRevision
        && (!sameSpeechIdentity(request.usage, hold.settledUsage) || request.outcome !== hold.settledOutcome)) {
        throw new SpeechAccountingError('conflict');
      }
      return false;
    }
    const observedCost = request.usage ? priceSpeechUsage(hold.price, request.usage) : 0;
    const operationalCost = hold.usage ? priceSpeechUsage(hold.price, hold.usage.totals) : 0;
    const costMicroUsd = complete ? observedCost : Math.max(hold.liabilityMicroUsd, observedCost, operationalCost);
    if (!complete && hold.state === 'estimated' && costMicroUsd <= hold.chargedMicroUsd) return false;
    const revision = hold.settlementRevision + 1;
    const kind = hold.rootEntryRef ? 'adjustment' : complete ? 'final' : 'estimate';
    const entryRef = JSON.stringify([request.operationId, kind, revision]);
    const overrun = costMicroUsd > hold.liabilityMicroUsd || Object.entries(request.usage ?? {}).some(([key, value]) =>
      hold.operation.ceiling[key as keyof SpeechUsage] !== undefined && value > hold.operation.ceiling[key as keyof SpeechUsage]!);
    const entry: SpeechSettlementEntry = { entryRef, operation: hold.operation, campaignRef: hold.campaignRef,
      utcDay: hold.utcDay, kind, ...(hold.rootEntryRef ? { rootEntryRef: hold.rootEntryRef } : {}), revision,
      ...(complete ? { providerRevision: request.providerRevision } : {}), pricingRevision: hold.price.revision,
      costMicroUsd, deltaMicroUsd: costMicroUsd - hold.chargedMicroUsd, uncertain: !complete,
      ...(request.usage ?? hold.usage?.totals ? { usage: request.usage ?? hold.usage?.totals } : {}),
      countedUnitDelta: 0, outcome: request.outcome, overrun };
    await tx.appendSettlement(entry);
    await tx.adjustBudgets(hold.campaignRef, hold.utcDay,
      hold.state === 'reserved' ? -hold.liabilityMicroUsd : 0, entry.deltaMicroUsd);
    hold.rootEntryRef ??= entryRef;
    hold.chargedMicroUsd = costMicroUsd;
    hold.settlementRevision = revision;
    hold.state = complete ? 'settled' : 'estimated';
    if (complete) {
      hold.providerRevision = request.providerRevision; hold.settledUsage = request.usage; hold.settledOutcome = request.outcome;
    }
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
