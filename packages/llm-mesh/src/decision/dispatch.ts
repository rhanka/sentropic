import type { DecisionServiceOptions } from './host-options.js';
import type { DecisionExecution } from './execution.js';
import { closeDecisionReceipt, copyDecisionReceipt, decisionInterruption, persistDecisionResult } from './execution.js';
import type { DecisionSelection } from './service.js';
import type { AdmittedDecision } from './admission.js';
import { parseDecisionAdapterResult } from './adapter-result.js';
import { createDecisionError } from './errors.js';
import { unreportedDecisionUsage } from './receipt.js';
import * as pricing from './pricing.js';
import { getSecretAuthMaterial } from '../auth.js';
import { freezeDecisionData } from './descriptor-validation.js';

/** One adapter invocation. Financial retries belong exclusively to the durable host. */
export async function dispatchDecision(execution: DecisionExecution, selection: Extract<DecisionSelection, { ok: true }>,
  admitted: Extract<AdmittedDecision, { ok: true }>, options: DecisionServiceOptions) {
  const receipt = execution.receipt;
  execution.phase = 'dispatch';
  receipt.attempts = 1;
  receipt.dispatch = 'started';
  receipt.usage = unreportedDecisionUsage('unknown');
  const remaining = Math.max(1, Math.min(60000, Math.ceil(execution.deadline - execution.clock.monotonic())));
  const request = freezeDecisionData({ ...selection.request, policy: { ...selection.request.policy, timeoutMs: remaining } });
  let candidate: unknown;
  try { candidate = await selection.adapter.decision!(request, { auth: admitted.auth, signal: execution.signal }); }
  catch { candidate = { ok: false, error: createDecisionError('TRANSPORT_FAILED', 'dispatch'),
    usage: unreportedDecisionUsage('unknown'), servedEvaluator: null, servedModelId: null }; }
  const material = getSecretAuthMaterial(admitted.auth);
  execution.phase = 'settlement';
  const secret = material?.type === 'environment-token' ? material.token! : '';
  const result = parseDecisionAdapterResult(candidate, request, selection.descriptor, secret);
  receipt.dispatch = result.ok || result.error.phase === 'parse' ? 'completed' : 'unknown';
  receipt.usage = result.usage;
  receipt.servedEvaluator = result.servedEvaluator;
  receipt.servedModelId = result.servedModelId;
  if (result.providerRequestId) receipt.providerRequestId = result.providerRequestId;
  if (result.providerLatencyMs !== undefined) receipt.providerLatencyMs = result.providerLatencyMs;
  const priced = pricing.priceDecisionUsage(result.usage, admitted.quote, !result.ok && result.error.code === 'SERVED_IDENTITY_MISMATCH');
  receipt.cost = priced.cost;
  receipt.budget = { state: priced.pending ? 'pending-reconciliation' : 'settled',
    reservedMicroUsd: admitted.quote.reservedMicroUsd, overrun: priced.overrun };
  let error = result.ok ? decisionInterruption(execution, 'settlement') ?? undefined : result.error;
  if (!result.ok && result.error.code === 'CANCELLED' && (execution.expired || execution.clock.monotonic() >= execution.deadline)) {
    error = createDecisionError('TIMEOUT', result.error.phase);
  }
  closeDecisionReceipt(execution, error);
  // Invalid native usage cannot release the admitted hold through settlement.
  const retainHold = selection.descriptor.protocol === 'openai-decisions' && !result.ok && result.error.code === 'USAGE_INVALID';
  try { if (!retainHold) await options.budget.settle({ holdId: admitted.holdId, receipt: copyDecisionReceipt(receipt), boundViolated: priced.overrun }); }
  catch {
    receipt.budget.state = 'pending-reconciliation';
    error = createDecisionError('SETTLEMENT_UNAVAILABLE', 'settlement');
    closeDecisionReceipt(execution, error);
  }
  return persistDecisionResult(execution, options.receipts, error, result.ok ? result.verdict : undefined);
}
