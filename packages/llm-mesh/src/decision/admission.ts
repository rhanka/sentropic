import type { AuthResolution } from '../auth.js';
import type { JudgeError } from './errors.js';
import { createJudgeError } from './errors.js';
import type { JudgeServiceOptions } from './host-options.js';
import type { JudgeSelection } from './service.js';
import { resolveJudgeAuth } from './service.js';
import type { JudgeExecution } from './execution.js';
import { judgeInterruption } from './execution.js';
import { quoteJudge, priceJudgeUsage } from './pricing.js';
import type { JudgeQuote } from './pricing.js';
import { unreportedJudgeUsage } from './receipt.js';
import { isCorrelationId } from './validation.js';

export type AdmittedJudge = { ok: true; holdId: string; quote: JudgeQuote; auth: AuthResolution }
  | { ok: false; error: JudgeError };
export async function judgeAuthority(options: JudgeServiceOptions, selection: Extract<JudgeSelection, { ok: true }>): Promise<boolean> {
  try { return await options.authorize({ ...selection.descriptor.evaluator }) === true; }
  catch { return false; }
}
export async function releaseUnsentJudge(execution: JudgeExecution, options: JudgeServiceOptions,
  holdId: string, error: JudgeError): Promise<AdmittedJudge> {
  try {
    await options.budget.release({ holdId, callId: execution.receipt.callId });
    execution.receipt.budget.state = 'released';
    execution.receipt.dispatch = 'not-started';
    execution.receipt.cost = { status: 'not-incurred', amountMicroUsd: '0', source: 'no-dispatch' };
    return { ok: false, error };
  } catch { return { ok: false, error: createJudgeError('SETTLEMENT_UNAVAILABLE', 'settlement') }; }
}

export async function admitJudge(execution: JudgeExecution, selection: Extract<JudgeSelection, { ok: true }>,
  options: JudgeServiceOptions): Promise<AdmittedJudge> {
  const failed = (error: JudgeError): AdmittedJudge => ({ ok: false, error });
  execution.phase = 'admission';
  let expired = judgeInterruption(execution, 'admission');
  if (expired) return failed(expired);
  if (!await judgeAuthority(options, selection)) return failed(createJudgeError('AUTHORIZATION_DENIED', 'preflight'));
  expired = judgeInterruption(execution, 'admission');
  if (expired) return failed(expired);
  let candidate: unknown;
  try { candidate = await options.resolvePrice({ providerId: 'typesafe', modelId: selection.descriptor.wireModel }); }
  catch { return failed(createJudgeError('PRICING_UNAVAILABLE', 'admission')); }
  expired = judgeInterruption(execution, 'admission');
  if (expired) return failed(expired);
  const quoted = quoteJudge(selection.request, selection.descriptor, candidate, options.policy?.maxCostMicroUsd);
  if (!quoted.ok) return failed(createJudgeError(quoted.code, 'admission'));
  execution.phase = 'preflight';
  const resolved = await resolveJudgeAuth(selection.descriptor, options.resolveAuth);
  if (!resolved.ok) return failed(createJudgeError(resolved.code, 'preflight'));
  const interrupted = judgeInterruption(execution, 'admission');
  if (interrupted) return failed(interrupted);
  const { quote } = quoted;
  execution.phase = 'admission';
  // Expose pending liability before awaiting admission: a late durable hold may exist.
  execution.receipt.budget = { state: 'pending-reconciliation', reservedMicroUsd: quote.reservedMicroUsd, overrun: false };
  execution.receipt.cost = priceJudgeUsage(unreportedJudgeUsage('unknown'), quote).cost;
  const deadlineAt = execution.clock.wall() + Math.max(0, execution.deadline - execution.clock.monotonic());
  let holdId: string;
  try {
    const admitted = await options.budget.admit({ callId: execution.receipt.callId, correlationId: execution.receipt.correlationId,
      evaluator: { ...selection.descriptor.evaluator }, quote, deadlineAt });
    if (!admitted.ok) {
      execution.receipt.budget = { state: 'not-admitted', overrun: false };
      execution.receipt.cost = { status: 'not-incurred', amountMicroUsd: '0', source: 'no-dispatch' };
      const code = ['BUDGET_EXHAUSTED', 'PROVIDER_UNAVAILABLE'].some((v) => v === admitted.code) ? admitted.code : 'BUDGET_UNAVAILABLE';
      return failed(createJudgeError(code, 'admission'));
    }
    holdId = admitted.holdId;
    if (!isCorrelationId(holdId)) throw new Error('Invalid hold acknowledgement.');
  } catch {
    return failed(createJudgeError('BUDGET_UNAVAILABLE', 'dispatch'));
  }
  execution.phase = 'dispatch';
  let stopped = judgeInterruption(execution, 'dispatch');
  if (!stopped && !await judgeAuthority(options, selection)) stopped = createJudgeError('AUTHORIZATION_DENIED', 'dispatch');
  stopped ??= judgeInterruption(execution, 'dispatch');
  if (stopped) return releaseUnsentJudge(execution, options, holdId, stopped);
  try {
    const marked = await options.budget.markDispatched({ holdId, callId: execution.receipt.callId,
      evaluator: { ...selection.descriptor.evaluator }, deadlineAt });
    if (!marked.ok) {
      const error = createJudgeError(marked.code === 'PROVIDER_UNAVAILABLE' ? 'PROVIDER_UNAVAILABLE' : 'BUDGET_UNAVAILABLE', 'dispatch');
      if (marked.provenUnsent === true) return releaseUnsentJudge(execution, options, holdId, error);
      // Ambiguous marker: attempts remains 0 since no provider dispatch was made; dispatch is unknown.
      execution.receipt.dispatch = 'unknown';
      return failed(error);
    }
  } catch {
    // Ambiguous marker exception: attempts remains 0 since no provider dispatch was made; dispatch is unknown.
    execution.receipt.dispatch = 'unknown';
    return failed(createJudgeError('BUDGET_UNAVAILABLE', 'dispatch'));
  }
  stopped = judgeInterruption(execution, 'dispatch');
  if (!stopped && !await judgeAuthority(options, selection)) stopped = createJudgeError('AUTHORIZATION_DENIED', 'dispatch');
  stopped ??= judgeInterruption(execution, 'dispatch');
  if (stopped) return releaseUnsentJudge(execution, options, holdId, stopped);
  return { ok: true, holdId, quote, auth: resolved.auth };
}
