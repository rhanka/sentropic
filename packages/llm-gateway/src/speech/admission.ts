import type { SpeechBinding, SpeechConfigurationReference, SpeechTarget } from '@sentropic/llm-mesh';
import type { CostContext } from '../ports/cost-context.js';
import { priceSpeechUsage, validateSpeechUsage, type SpeechPrice, type SpeechUsage, type SpeechUsageState } from './usage.js';
import type { SpeechSettlementEntry } from './settlement.js';

export const SPEECH_DAILY_MICRO_USD = 5_000_000;
export const SPEECH_CAMPAIGN_MICRO_USD = 20_000_000;
export interface SpeechOperation {
  readonly operationId: string; readonly sessionId: string; readonly attemptId: string;
  readonly backendOperationRef: string; readonly nativeTurnRef?: string; readonly submitKey: string;
  readonly coordinatorEpoch: number; readonly allocatorReceiptRef: string;
  readonly stage: 'stt' | 'tts' | 'duplex'; readonly cost: CostContext;
  readonly binding: SpeechBinding & { readonly accountRef: string; readonly region: string };
  readonly configuration: SpeechConfigurationReference; readonly target: SpeechTarget;
  readonly ceiling: SpeechUsage; readonly maxDurationMs: number; readonly maxConcurrent: number;
}
export interface SpeechAllocatorReceipt {
  readonly receiptRef: string; readonly tenantId: string; readonly workspaceId?: string; readonly principalId: string;
  readonly targetSessionId: string; readonly nativeTurnRef?: string; readonly submitKey: string;
  readonly coordinatorEpoch: number; readonly countedUnits: 0 | 1; readonly backendOperationRef: string;
}
export interface SpeechHold {
  operation: SpeechOperation; campaignRef: string; utcDay: string; price: SpeechPrice;
  liabilityMicroUsd: number; expiresAtMs: number; dispatched: boolean;
  state: 'reserved' | 'estimated' | 'settled'; chargedMicroUsd: number; settlementRevision: number;
  rootEntryRef?: string; providerRevision?: number; usage?: SpeechUsageState; settledUsage?: SpeechUsage;
  settledOutcome?: SpeechSettlementEntry['outcome'];
}
export interface SpeechBudgetSnapshot { readonly spentMicroUsd: number; readonly reservedMicroUsd: number }
/** Views over existing owner tables, not a second speech ledger or quota counter. */
export interface SpeechLedgerTransaction {
  /** Acquire owner locks for hold + all budget buckets in the owner's common lock order. */
  lock(campaignRef: string, operationId: string, utcDay: string): Promise<void>;
  getHold(operationId: string): Promise<SpeechHold | undefined>;
  /** Persists in existing budget_holds; retains the pool lease while reserved and dispatched. */
  putHold(hold: SpeechHold): Promise<void>;
  budgets(campaignRef: string, utcDay: string): Promise<{ daily: SpeechBudgetSnapshot; campaign: SpeechBudgetSnapshot }>;
  /** Update the SAME owner buckets used by admission, settlement and reaping, including tighter policies. */
  adjustBudgets(campaignRef: string, utcDay: string, reservedDelta: number, spentDelta: number): Promise<void>;
  allocatorReceipt(receiptRef: string): Promise<SpeechAllocatorReceipt | undefined>;
  price(binding: SpeechOperation['binding'], nowMs: number): Promise<SpeechPrice | undefined>;
  /** Existing pool admission/lease count; expired but unreconciled holds must retain budget liability. */
  activeConnections(accountRef: string, nowMs: number): Promise<number>;
  appendSettlement(entry: SpeechSettlementEntry): Promise<void>;
}
export interface SpeechLedgerPort {
  readonly durability: 'durable';
  /** Atomic commit/rollback, serializable across processes and restarts, using the established ledger DB. */
  transaction<T>(change: (tx: SpeechLedgerTransaction) => Promise<T>): Promise<T>;
}
export interface SpeechAccountingOptions {
  /** Trusted host campaign identity, shared across providers, accounts, reconnects and retries. */
  readonly campaignRef: string; readonly ledger?: SpeechLedgerPort; readonly now?: () => number;
  readonly dailyCapMicroUsd?: number; readonly campaignCapMicroUsd?: number;
}
export class SpeechAccountingError extends Error {
  constructor(readonly code: 'unavailable' | 'cap' | 'invalid' | 'conflict' | 'allocator' | 'expired' | 'concurrency') {
    super(`Speech accounting refused: ${code}`); this.name = 'SpeechAccountingError';
  }
}
export const speechTransaction = async <T>(options: SpeechAccountingOptions,
  change: (tx: SpeechLedgerTransaction, nowMs: number, campaignRef: string) => Promise<T>): Promise<T> => {
  const { campaignRef, ledger } = options;
  if (!campaignRef || ledger?.durability !== 'durable') throw new SpeechAccountingError('unavailable');
  try {
    const nowMs = (options.now ?? Date.now)();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new SpeechAccountingError('unavailable');
    return await ledger.transaction(tx => change(tx, nowMs, campaignRef));
  } catch (error) {
    if (error instanceof SpeechAccountingError) throw error;
    throw new SpeechAccountingError('unavailable');
  }
};
export const utcSpeechDay = (nowMs: number): string => new Date(nowMs).toISOString().slice(0, 10);
export const sameSpeechIdentity = (a: unknown, b: unknown): boolean => {
  const ordered = (v: unknown): unknown => v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, ordered(x)])) : v;
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
};

const positive = (v: number): boolean => Number.isSafeInteger(v) && v > 0;
const cap = (value: number | undefined, hard: number): number => {
  if (value !== undefined && !positive(value)) throw new SpeechAccountingError('invalid');
  return Math.min(value ?? hard, hard);
};
const validateOperation = (op: SpeechOperation): void => {
  const keys = ['operationId', 'sessionId', 'attemptId', 'backendOperationRef', 'nativeTurnRef', 'submitKey',
    'coordinatorEpoch', 'allocatorReceiptRef', 'stage', 'cost', 'binding', 'configuration', 'target',
    'ceiling', 'maxDurationMs', 'maxConcurrent'];
  if (Object.keys(op).some(key => !keys.includes(key))) throw new SpeechAccountingError('invalid');
  const nestedKeys: readonly [object, readonly string[]][] = [
    [op.binding, ['providerId', 'modelId', 'modelRevision', 'adapterId', 'adapterRevision', 'placement',
      'language', 'voice', 'region', 'accountRef', 'resourceRef']],
    [op.configuration, ['profileId', 'configRevision', 'policyRef']],
    [op.target, ['sessionId', 'sourceGeneration', 'controllerEpoch', 'consentRevision']],
    [op.cost, ['tenantId', 'workspaceId', 'principalId', 'source', 'correlationId', 'callSite', 'budgetScope',
      'ownerScopeRef', 'gatewaySessionRef', 'gatewayReceiptId', 'gatewayClientSessionRef', 'launchRoutingContract']],
  ];
  if (nestedKeys.some(([value, allowed]) => !value || Object.keys(value).some(key => !allowed.includes(key)))) {
    throw new SpeechAccountingError('invalid');
  }
  const strings = [op.operationId, op.sessionId, op.attemptId, op.backendOperationRef,
    op.submitKey, op.allocatorReceiptRef, op.cost?.tenantId, op.cost?.workspaceId, op.cost?.principalId, op.cost?.source,
    op.cost?.correlationId, op.binding?.providerId, op.binding?.modelId, op.binding?.modelRevision,
    op.binding?.adapterId, op.binding?.adapterRevision, op.binding?.placement, op.binding?.accountRef,
    op.binding?.region, op.configuration?.profileId, op.configuration?.configRevision,
    op.configuration?.policyRef, op.target?.sessionId, op.target?.sourceGeneration, op.target?.consentRevision];
  if (strings.some(v => typeof v !== 'string' || !v) || !positive(op.coordinatorEpoch)
    || (op.nativeTurnRef !== undefined && (typeof op.nativeTurnRef !== 'string' || !op.nativeTurnRef))
    || !positive(op.target.controllerEpoch) || !positive(op.maxDurationMs) || !positive(op.maxConcurrent)
    || !['stt', 'tts', 'duplex'].includes(op.stage)) throw new SpeechAccountingError('invalid');
  try { validateSpeechUsage(op.ceiling); } catch { throw new SpeechAccountingError('invalid'); }
  if (op.ceiling.connectedSeconds !== op.maxDurationMs / 1000) throw new SpeechAccountingError('invalid');
};

/** Called only with auth-derived CostContext and the server's selected configuration/engine bounds. */
export const admitSpeech = async (options: SpeechAccountingOptions, input: SpeechOperation): Promise<SpeechHold> => {
  const operation = structuredClone(input);
  validateOperation(operation);
  const dailyCap = cap(options.dailyCapMicroUsd, SPEECH_DAILY_MICRO_USD);
  const campaignCap = cap(options.campaignCapMicroUsd, SPEECH_CAMPAIGN_MICRO_USD);
  return speechTransaction(options, async (tx, nowMs, campaignRef) => {
    const utcDay = utcSpeechDay(nowMs);
    await tx.lock(campaignRef, operation.operationId, utcDay);
    const previous = await tx.getHold(operation.operationId);
    if (previous) {
      if (previous.campaignRef !== campaignRef || !sameSpeechIdentity(previous.operation, operation)) {
        throw new SpeechAccountingError('conflict');
      }
      // Replays recover the same hold; they never authorize a second provider connection.
      return structuredClone(previous);
    }
    // Each bounded connection ends in its reservation's UTC day. Renewal needs a new admitted operation.
    if (nowMs + operation.maxDurationMs > Date.parse(`${utcDay}T00:00:00Z`) + 86_400_000) {
      throw new SpeechAccountingError('invalid');
    }
    const receipt = await tx.allocatorReceipt(operation.allocatorReceiptRef);
    if (!receipt || receipt.receiptRef !== operation.allocatorReceiptRef
      || receipt.tenantId !== operation.cost.tenantId || receipt.workspaceId !== operation.cost.workspaceId
      || receipt.principalId !== operation.cost.principalId || receipt.targetSessionId !== operation.target.sessionId
      || receipt.nativeTurnRef !== operation.nativeTurnRef || receipt.submitKey !== operation.submitKey
      || receipt.coordinatorEpoch !== operation.coordinatorEpoch || ![0, 1].includes(receipt.countedUnits)
      || receipt.backendOperationRef !== operation.backendOperationRef) {
      throw new SpeechAccountingError('allocator');
    }
    const price = await tx.price(operation.binding, nowMs);
    if (!price || price.providerId !== operation.binding.providerId || price.modelId !== operation.binding.modelId
      || price.region !== operation.binding.region || price.effectiveAtMs > nowMs || price.expiresAtMs <= nowMs
      || Object.keys(price.rates).some(key => operation.ceiling[key as keyof SpeechUsage] === undefined)) {
      throw new SpeechAccountingError('unavailable');
    }
    const liabilityMicroUsd = priceSpeechUsage(price, operation.ceiling);
    if (!positive(liabilityMicroUsd)) throw new SpeechAccountingError('invalid');
    const budgets = await tx.budgets(campaignRef, utcDay);
    for (const [bucket, limit] of [[budgets.daily, dailyCap], [budgets.campaign, campaignCap]] as const) {
      if (!Number.isSafeInteger(bucket.spentMicroUsd) || bucket.spentMicroUsd < 0
        || !Number.isSafeInteger(bucket.reservedMicroUsd) || bucket.reservedMicroUsd < 0) {
        throw new SpeechAccountingError('unavailable');
      }
      if (BigInt(bucket.spentMicroUsd) + BigInt(bucket.reservedMicroUsd) + BigInt(liabilityMicroUsd) > BigInt(limit)) {
        throw new SpeechAccountingError('cap');
      }
    }
    const active = await tx.activeConnections(operation.binding.accountRef, nowMs);
    if (!Number.isSafeInteger(active) || active < 0) throw new SpeechAccountingError('unavailable');
    if (active >= operation.maxConcurrent) throw new SpeechAccountingError('concurrency');
    const hold: SpeechHold = { operation, campaignRef, utcDay, price,
      liabilityMicroUsd, expiresAtMs: nowMs + operation.maxDurationMs, dispatched: false,
      state: 'reserved', chargedMicroUsd: 0, settlementRevision: -1 };
    await tx.adjustBudgets(hold.campaignRef, utcDay, liabilityMicroUsd, 0);
    await tx.putHold(hold);
    return structuredClone(hold);
  });
};

/** Durable, one-shot dispatch claim. An ambiguous acknowledgement never allows replay. */
export const markSpeechDispatched = async (options: SpeechAccountingOptions, operationId: string): Promise<boolean> =>
  speechTransaction(options, async (tx, nowMs, campaignRef) => {
    await tx.lock(campaignRef, operationId, utcSpeechDay(nowMs));
    const hold = await tx.getHold(operationId);
    if (!hold || hold.campaignRef !== campaignRef) throw new SpeechAccountingError('invalid');
    if (hold.dispatched || hold.state !== 'reserved') return false;
    if (hold.expiresAtMs <= nowMs) throw new SpeechAccountingError('expired');
    hold.dispatched = true;
    await tx.putHold(hold);
    return true;
  });
