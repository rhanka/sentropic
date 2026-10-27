import type { SpeechBinding, SpeechConfigurationReference, SpeechTarget } from '@sentropic/llm-mesh';
import type { CostContext } from '../ports/cost-context.js';
import { priceSpeechUsage, validateSpeechUsage, type SpeechPrice, type SpeechUsage, type SpeechUsageState } from './usage.js';
import type { SpeechSettlementEntry } from './settlement.js';

export const SPEECH_DAILY_MICRO_USD = 5_000_000;
export const SPEECH_CAMPAIGN_MICRO_USD = 20_000_000;
export interface SpeechOperation {
  readonly operationId: string; readonly sessionId: string; readonly attemptId: string;
  readonly backendOperationRef: string; readonly nativeTurnRef: string; readonly submitKey: string;
  readonly coordinatorEpoch: number; readonly allocatorReceiptRef: string;
  readonly stage: 'stt' | 'tts' | 'duplex'; readonly cost: CostContext;
  readonly binding: SpeechBinding & { readonly accountRef: string; readonly region: string };
  readonly configuration: SpeechConfigurationReference; readonly target: SpeechTarget;
  readonly ceiling: SpeechUsage; readonly maxDurationMs: number; readonly maxConcurrent: number;
}
export interface SpeechAllocatorReceipt {
  readonly receiptRef: string; readonly tenantId: string; readonly workspaceId?: string; readonly principalId: string;
  readonly targetSessionId: string; readonly nativeTurnRef: string; readonly submitKey: string;
  readonly coordinatorEpoch: number; readonly countedUnits: 0 | 1;
}
export interface SpeechHold {
  operation: SpeechOperation; campaignRef: string; utcDay: string; price: SpeechPrice;
  liabilityMicroUsd: number; expiresAtMs: number; dispatched: boolean;
  state: 'reserved' | 'estimated' | 'settled'; chargedMicroUsd: number; settlementRevision: number;
  rootEntryRef?: string; providerRevision?: number; usage?: SpeechUsageState;
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
  change: (tx: SpeechLedgerTransaction, nowMs: number) => Promise<T>): Promise<T> => {
  if (!options.campaignRef || options.ledger?.durability !== 'durable') throw new SpeechAccountingError('unavailable');
  try {
    const nowMs = (options.now ?? Date.now)();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new SpeechAccountingError('unavailable');
    return await options.ledger.transaction(tx => change(tx, nowMs));
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
