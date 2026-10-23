import type { DecisionRequest, MicroUsd } from './request.js';
import type { DecisionBackendProtocol, DecisionEvaluatorDescriptor } from './descriptor.js';
import type { DecisionCost, DecisionUsage } from './receipt.js';
import { freezeDecisionData } from './descriptor-validation.js';
import { hasOnlyKeys, isCorrelationId, isRecord, snapshotBoundedJson } from './validation.js';

/** Projection of the host's existing immutable provider/model price row. The
 * optional authority/protocol cells bind a row to one price authority and
 * backend protocol; present cells must match the descriptor (§3.2
 * Accounting), so two authorities cannot share a revision silently. */
export interface DecisionPrice {
  providerId: string; modelId: string; priceRevision: string;
  inputMicroUsdPerMtok: MicroUsd; outputMicroUsdPerMtok: MicroUsd; minimumMicroUsd: MicroUsd;
  identityMismatchPricing: 'requested-model' | 'requires-reconciliation';
  authority?: string; protocol?: DecisionBackendProtocol;
}
export interface DecisionQuote { price: DecisionPrice; reservedMicroUsd: MicroUsd }
export const isMicroUsd = (value: unknown): value is MicroUsd => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
const ceilRate = (tokens: number, rate: string) => (BigInt(tokens) * BigInt(rate) + 999999n) / 1000000n;
const minimum = (value: bigint, price: DecisionPrice) => value > BigInt(price.minimumMicroUsd) ? value : BigInt(price.minimumMicroUsd);

export function quoteDecision(request: DecisionRequest, descriptor: DecisionEvaluatorDescriptor, candidate: unknown,
  hostCap?: MicroUsd): { ok: true; quote: DecisionQuote } | { ok: false; code: 'PRICING_UNAVAILABLE' | 'BUDGET_BOUND_UNAVAILABLE' | 'BUDGET_EXHAUSTED' } {
  const snapshot = snapshotBoundedJson(candidate);
  const value = snapshot.ok ? snapshot.value : null;
  if (!isRecord(value) || !hasOnlyKeys(value, ['providerId', 'modelId', 'priceRevision', 'inputMicroUsdPerMtok',
    'outputMicroUsdPerMtok', 'minimumMicroUsd', 'identityMismatchPricing', 'authority', 'protocol']) || value.providerId !== descriptor.evaluator.providerId
    || value.modelId !== descriptor.wireModel || value.priceRevision !== descriptor.priceProtocol.revision
    || !isCorrelationId(value.priceRevision)
    || !isMicroUsd(value.inputMicroUsdPerMtok) || !isMicroUsd(value.outputMicroUsdPerMtok) || !isMicroUsd(value.minimumMicroUsd)
    || !['requested-model', 'requires-reconciliation'].some((v) => v === value.identityMismatchPricing)
    || (value.authority !== undefined && value.authority !== descriptor.priceProtocol.authority)
    || (value.protocol !== undefined && value.protocol !== (descriptor.protocol ?? 'jev-native'))) return { ok: false, code: 'PRICING_UNAVAILABLE' };
  const price = freezeDecisionData(value as unknown as DecisionPrice);
  if (descriptor.qualification.billingBound !== 'qualified') return { ok: false, code: 'BUDGET_BOUND_UNAVAILABLE' };
  const isJev = (descriptor.protocol ?? 'jev-native') === 'jev-native';
  // JEV has no qualified output liability bound. A nonzero output rate cannot be reserved.
  if (isJev && price.outputMicroUsdPerMtok !== '0') return { ok: false, code: 'BUDGET_BOUND_UNAVAILABLE' };
  // Non-JEV protocols price output work, so quoting requires the descriptor's
  // enforced output/reasoning bound. Without it no finite liability exists.
  const outputBound = descriptor.maxBillableOutputTokens;
  if (!isJev && (typeof outputBound !== 'number' || !Number.isSafeInteger(outputBound) || outputBound < 1)) {
    return { ok: false, code: 'BUDGET_BOUND_UNAVAILABLE' };
  }
  const inputReserve = ceilRate(descriptor.maxBillableInputTokens, price.inputMicroUsdPerMtok);
  const outputReserve = isJev ? 0n : ceilRate(descriptor.maxBillableOutputTokens, price.outputMicroUsdPerMtok);
  const reserve = minimum(inputReserve + outputReserve, price);
  const caps = [hostCap, request.policy?.budget?.maxCostMicroUsd].filter((v): v is string => v !== undefined);
  if (caps.some((cap) => !isMicroUsd(cap))) return { ok: false, code: 'PRICING_UNAVAILABLE' };
  if (caps.some((cap) => reserve > BigInt(cap))) return { ok: false, code: 'BUDGET_EXHAUSTED' };
  return { ok: true, quote: freezeDecisionData({ price, reservedMicroUsd: reserve.toString() }) };
}

/** Uncertain execution uses the reserve, never invented tokens or a zero charge.
 * Any priced component whose usage is unknown keeps the settlement pending
 * and charges at least the full reserve: known input spend never releases
 * the unknown output liability. */
export function priceDecisionUsage(usage: DecisionUsage, quote: DecisionQuote, identityMismatch = false):
  { cost: DecisionCost; pending: boolean; overrun: boolean } {
  const input = usage.tokens.input;
  const output = usage.tokens.output;
  const applicable = !identityMismatch || quote.price.identityMismatchPricing === 'requested-model';
  const inputKnown = input.source === 'provider' && applicable;
  const outputKnown = inputKnown && output.source === 'provider';
  const inputPriced = quote.price.inputMicroUsdPerMtok !== '0';
  const outputPriced = quote.price.outputMicroUsdPerMtok !== '0';
  const pricedUnknown = (inputPriced && !inputKnown) || (outputPriced && !outputKnown);
  const inputAmount = inputKnown ? ceilRate(input.value, quote.price.inputMicroUsdPerMtok) : 0n;
  const outputAmount = outputKnown ? ceilRate(output.value, quote.price.outputMicroUsdPerMtok) : 0n;
  const computed = inputKnown || outputKnown ? minimum(inputAmount + outputAmount, quote.price) : BigInt(quote.reservedMicroUsd);
  const reserved = BigInt(quote.reservedMicroUsd);
  const amount = pricedUnknown && computed < reserved ? reserved : computed;
  const fullyUnknown = !inputKnown && !outputKnown;
  return { cost: { status: 'estimated', amountMicroUsd: amount.toString(),
    source: fullyUnknown || pricedUnknown ? 'reserved-liability' : 'reported-usage-times-rate',
    priceRevision: quote.price.priceRevision, rounding: 'ceil-micro-usd' },
  pending: pricedUnknown, overrun: amount > reserved };
}
