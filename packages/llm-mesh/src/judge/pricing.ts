import type { JudgeRequest, MicroUsd } from './request.js';
import type { EvaluatorDescriptor } from './jev-descriptor.js';
import type { JudgeCost, JudgeUsage } from './receipt.js';
import { freezeJudgeData } from './descriptor-validation.js';
import { hasOnlyKeys, isCorrelationId, isRecord, snapshotBoundedJson } from './validation.js';

/** Projection of the host's existing immutable provider/model price row. */
export interface JudgePrice {
  providerId: 'typesafe'; modelId: string; priceRevision: string;
  inputMicroUsdPerMtok: MicroUsd; outputMicroUsdPerMtok: MicroUsd; minimumMicroUsd: MicroUsd;
  identityMismatchPricing: 'requested-model' | 'requires-reconciliation';
}
export interface JudgeQuote { price: JudgePrice; reservedMicroUsd: MicroUsd }
export const isMicroUsd = (value: unknown): value is MicroUsd => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
const ceilRate = (tokens: number, rate: string) => (BigInt(tokens) * BigInt(rate) + 999999n) / 1000000n;
const minimum = (value: bigint, price: JudgePrice) => value > BigInt(price.minimumMicroUsd) ? value : BigInt(price.minimumMicroUsd);

export function quoteJudge(request: JudgeRequest, descriptor: EvaluatorDescriptor, candidate: unknown,
  hostCap?: MicroUsd): { ok: true; quote: JudgeQuote } | { ok: false; code: 'PRICING_UNAVAILABLE' | 'BUDGET_BOUND_UNAVAILABLE' | 'BUDGET_EXHAUSTED' } {
  const snapshot = snapshotBoundedJson(candidate);
  const value = snapshot.ok ? snapshot.value : null;
  if (!isRecord(value) || !hasOnlyKeys(value, ['providerId', 'modelId', 'priceRevision', 'inputMicroUsdPerMtok',
    'outputMicroUsdPerMtok', 'minimumMicroUsd', 'identityMismatchPricing']) || value.providerId !== descriptor.evaluator.providerId
    || value.modelId !== descriptor.wireModel || !isCorrelationId(value.priceRevision)
    || !isMicroUsd(value.inputMicroUsdPerMtok) || !isMicroUsd(value.outputMicroUsdPerMtok) || !isMicroUsd(value.minimumMicroUsd)
    || !['requested-model', 'requires-reconciliation'].some((v) => v === value.identityMismatchPricing)) return { ok: false, code: 'PRICING_UNAVAILABLE' };
  const price = freezeJudgeData(value as unknown as JudgePrice);
  // JEV has no qualified output liability bound. A nonzero output rate cannot be reserved.
  if (descriptor.qualification.billingBound !== 'qualified' || price.outputMicroUsdPerMtok !== '0') return { ok: false, code: 'BUDGET_BOUND_UNAVAILABLE' };
  const reserve = minimum(ceilRate(descriptor.maxBillableInputTokens, price.inputMicroUsdPerMtok), price);
  const caps = [hostCap, request.policy?.budget?.maxCostMicroUsd].filter((v) => v !== undefined);
  if (caps.some((cap) => !isMicroUsd(cap))) return { ok: false, code: 'PRICING_UNAVAILABLE' };
  if (caps.some((cap) => reserve > BigInt(cap))) return { ok: false, code: 'BUDGET_EXHAUSTED' };
  return { ok: true, quote: freezeJudgeData({ price, reservedMicroUsd: reserve.toString() }) };
}

/** Uncertain execution uses the reserve, never invented tokens or a zero charge. */
export function priceJudgeUsage(usage: JudgeUsage, quote: JudgeQuote, identityMismatch = false):
  { cost: JudgeCost; pending: boolean; overrun: boolean } {
  const input = usage.tokens.input;
  const applicable = !identityMismatch || quote.price.identityMismatchPricing === 'requested-model';
  const known = input.source === 'provider' && applicable;
  const amount = known ? minimum(ceilRate(input.value, quote.price.inputMicroUsdPerMtok), quote.price) : BigInt(quote.reservedMicroUsd);
  return { cost: { status: 'estimated', amountMicroUsd: amount.toString(),
    source: known ? 'reported-usage-times-rate' : 'reserved-liability', priceRevision: quote.price.priceRevision, rounding: 'ceil-micro-usd' },
  pending: !known, overrun: amount > BigInt(quote.reservedMicroUsd) };
}
