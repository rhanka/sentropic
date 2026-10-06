import type { JudgeServiceOptions } from './host-options.js';
import type { JudgeExecution } from './execution.js';
import { closeJudgeReceipt, copyJudgeReceipt, judgeInterruption, persistJudgeResult } from './execution.js';
import type { JudgeSelection } from './service.js';
import type { AdmittedJudge } from './admission.js';
import { parseJudgeAdapterResult } from './adapter-result.js';
import { createJudgeError } from './errors.js';
import { unreportedJudgeUsage } from './receipt.js';
import { priceJudgeUsage } from './pricing.js';
import { getSecretAuthMaterial } from '../auth.js';
import { freezeJudgeData } from './descriptor-validation.js';

/** One adapter invocation. Financial retries belong exclusively to the durable host. */
export async function dispatchJudge(execution: JudgeExecution, selection: Extract<JudgeSelection, { ok: true }>,
  admitted: Extract<AdmittedJudge, { ok: true }>, options: JudgeServiceOptions) {
  const receipt = execution.receipt;
  execution.phase = 'dispatch';
  receipt.attempts = 1;
  receipt.dispatch = 'started';
  receipt.usage = unreportedJudgeUsage('unknown');
  const remaining = Math.max(1, Math.min(60000, Math.ceil(execution.deadline - execution.clock.monotonic())));
  const request = freezeJudgeData({ ...selection.request, policy: { ...selection.request.policy, timeoutMs: remaining } });
  let candidate: unknown;
  try { candidate = await selection.adapter.judge!(request, { auth: admitted.auth, signal: execution.signal }); }
  catch { candidate = { ok: false, error: createJudgeError('TRANSPORT_FAILED', 'dispatch'),
    usage: unreportedJudgeUsage('unknown'), servedEvaluator: null, servedModelId: null }; }
  const material = getSecretAuthMaterial(admitted.auth);
  execution.phase = 'settlement';
  const secret = material?.type === 'environment-token' ? material.token! : '';
  const result = parseJudgeAdapterResult(candidate, request, selection.descriptor, secret);
  receipt.dispatch = result.ok || result.error.phase === 'parse' ? 'completed' : 'unknown';
  receipt.usage = result.usage;
  receipt.servedEvaluator = result.servedEvaluator;
  receipt.servedModelId = result.servedModelId;
  if (result.providerRequestId) receipt.providerRequestId = result.providerRequestId;
  if (result.providerLatencyMs !== undefined) receipt.providerLatencyMs = result.providerLatencyMs;
  const priced = priceJudgeUsage(result.usage, admitted.quote, !result.ok && result.error.code === 'SERVED_IDENTITY_MISMATCH');
  receipt.cost = priced.cost;
  receipt.budget = { state: priced.pending ? 'pending-reconciliation' : 'settled',
    reservedMicroUsd: admitted.quote.reservedMicroUsd, overrun: priced.overrun };
  let error = result.ok ? judgeInterruption(execution, 'settlement') ?? undefined : result.error;
  closeJudgeReceipt(execution, error);
  try { await options.budget.settle({ holdId: admitted.holdId, receipt: copyJudgeReceipt(receipt), boundViolated: priced.overrun }); }
  catch {
    receipt.budget.state = 'pending-reconciliation';
    error = createJudgeError('SETTLEMENT_UNAVAILABLE', 'settlement');
  }
  error ??= judgeInterruption(execution, 'settlement') ?? undefined;
  return persistJudgeResult(execution, options.receipts, error, result.ok ? result.verdict : undefined);
}
