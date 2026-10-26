import type { AuthResolution } from '../auth.js';
import type { DecisionError } from './errors.js';
import { createDecisionError } from './errors.js';
import type { DecisionServiceOptions } from './host-options.js';
import type { DecisionSelection } from './service.js';
import { resolveDecisionAuth } from './service.js';
import type { DecisionExecution } from './execution.js';
import { decisionInterruption } from './execution.js';
import { quoteDecision, priceDecisionUsage } from './pricing.js';
import type { DecisionQuote } from './pricing.js';
import { unreportedDecisionUsage } from './receipt.js';
import { isCorrelationId } from './validation.js';
import { discoverDecisionEvaluator } from './qualification.js';

export type AdmittedDecision = { ok: true; holdId: string; quote: DecisionQuote; auth: AuthResolution }
  | { ok: false; error: DecisionError };
export async function decisionAuthority(options: DecisionServiceOptions, selection: Extract<DecisionSelection, { ok: true }>): Promise<boolean> {
  try { return await options.authorize({ ...selection.descriptor.evaluator }) === true; }
  catch { return false; }
}
export async function releaseUnsentDecision(execution: DecisionExecution, options: DecisionServiceOptions,
  holdId: string, error: DecisionError): Promise<AdmittedDecision> {
  try {
    await options.budget.release({ holdId, callId: execution.receipt.callId });
    execution.receipt.budget.state = 'released';
    execution.receipt.dispatch = 'not-started';
    execution.receipt.cost = { status: 'not-incurred', amountMicroUsd: '0', source: 'no-dispatch' };
    return { ok: false, error };
  } catch { return { ok: false, error: createDecisionError('SETTLEMENT_UNAVAILABLE', 'settlement') }; }
}

export async function admitDecision(execution: DecisionExecution, selection: Extract<DecisionSelection, { ok: true }>,
  options: DecisionServiceOptions): Promise<AdmittedDecision> {
  const failed = (error: DecisionError): AdmittedDecision => ({ ok: false, error });
  execution.phase = 'admission';
  let expired = decisionInterruption(execution, 'admission');
  if (expired) return failed(expired);
  if (!await decisionAuthority(options, selection)) return failed(createDecisionError('AUTHORIZATION_DENIED', 'preflight'));
  expired = decisionInterruption(execution, 'admission');
  if (expired) return failed(expired);
  let candidate: unknown;
  try { candidate = await options.resolvePrice({ providerId: selection.descriptor.evaluator.providerId,
    modelId: selection.descriptor.wireModel, protocol: selection.descriptor.protocol ?? 'jev-native',
    authority: selection.descriptor.priceProtocol.authority, priceRevision: selection.descriptor.priceProtocol.revision }); }
  catch { return failed(createDecisionError('PRICING_UNAVAILABLE', 'admission')); }
  expired = decisionInterruption(execution, 'admission');
  if (expired) return failed(expired);
  const quoted = quoteDecision(selection.request, selection.descriptor, candidate, options.policy?.maxCostMicroUsd);
  if (!quoted.ok) return failed(createDecisionError(quoted.code, 'admission'));
  if (selection.descriptor.executionProfile !== 'qualification'
    && !discoverDecisionEvaluator(selection.descriptor, { ...options.readiness,
      price: candidate } as Parameters<typeof discoverDecisionEvaluator>[1], selection.request).productionReady) {
    return failed(createDecisionError('PROVIDER_UNAVAILABLE', 'admission'));
  }
  execution.phase = 'preflight';
  const resolved = await resolveDecisionAuth(selection.descriptor, options.resolveAuth);
  if (!resolved.ok) return failed(createDecisionError(resolved.code, 'preflight'));
  const interrupted = decisionInterruption(execution, 'admission');
  if (interrupted) return failed(interrupted);
  const { quote } = quoted;
  execution.phase = 'admission';
  // Expose pending liability before awaiting admission: a late durable hold may exist.
  execution.receipt.budget = { state: 'pending-reconciliation', reservedMicroUsd: quote.reservedMicroUsd, overrun: false };
  execution.receipt.cost = priceDecisionUsage(unreportedDecisionUsage('unknown'), quote).cost;
  const deadlineAt = execution.clock.wall() + Math.max(0, execution.deadline - execution.clock.monotonic());
  let holdId: string;
  try {
    const admitted = await options.budget.admit({ callId: execution.receipt.callId, correlationId: execution.receipt.correlationId,
      evaluator: { ...selection.descriptor.evaluator }, quote, deadlineAt });
    if (!admitted.ok) {
      execution.receipt.budget = { state: 'not-admitted', overrun: false };
      execution.receipt.cost = { status: 'not-incurred', amountMicroUsd: '0', source: 'no-dispatch' };
      const code = ['BUDGET_EXHAUSTED', 'PROVIDER_UNAVAILABLE'].some((v) => v === admitted.code) ? admitted.code : 'BUDGET_UNAVAILABLE';
      return failed(createDecisionError(code, 'admission'));
    }
    holdId = admitted.holdId;
    if (!isCorrelationId(holdId)) throw new Error('Invalid hold acknowledgement.');
  } catch {
    return failed(createDecisionError('BUDGET_UNAVAILABLE', 'dispatch'));
  }
  execution.phase = 'dispatch';
  let stopped = decisionInterruption(execution, 'dispatch');
  if (!stopped && !await decisionAuthority(options, selection)) stopped = createDecisionError('AUTHORIZATION_DENIED', 'dispatch');
  stopped ??= decisionInterruption(execution, 'dispatch');
  if (stopped) return releaseUnsentDecision(execution, options, holdId, stopped);
  try {
    const marked = await options.budget.markDispatched({ holdId, callId: execution.receipt.callId,
      evaluator: { ...selection.descriptor.evaluator }, deadlineAt });
    if (!marked.ok) {
      const error = createDecisionError(marked.code === 'PROVIDER_UNAVAILABLE' ? 'PROVIDER_UNAVAILABLE' : 'BUDGET_UNAVAILABLE', 'dispatch');
      if (marked.provenUnsent === true) return releaseUnsentDecision(execution, options, holdId, error);
      // Ambiguous marker: attempts remains 0 since no provider dispatch was made; dispatch is unknown.
      execution.receipt.dispatch = 'unknown';
      return failed(error);
    }
  } catch {
    // Ambiguous marker exception: attempts remains 0 since no provider dispatch was made; dispatch is unknown.
    execution.receipt.dispatch = 'unknown';
    return failed(createDecisionError('BUDGET_UNAVAILABLE', 'dispatch'));
  }
  stopped = decisionInterruption(execution, 'dispatch');
  if (!stopped && !await decisionAuthority(options, selection)) stopped = createDecisionError('AUTHORIZATION_DENIED', 'dispatch');
  stopped ??= decisionInterruption(execution, 'dispatch');
  if (stopped) return releaseUnsentDecision(execution, options, holdId, stopped);
  return { ok: true, holdId, quote, auth: resolved.auth };
}
