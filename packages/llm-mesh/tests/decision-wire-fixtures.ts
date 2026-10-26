import type { DecisionRequest } from '../src/decision/request.js';
import type { DecisionResult } from '../src/decision/receipt.js';
import { beginDecisionExecution, closeDecisionReceipt } from '../src/decision/execution.js';
import { priceDecisionUsage, quoteDecision } from '../src/decision/pricing.js';
import { decisionPrice, decisionServiceFixture, jevResponse } from './decision-fixtures.js';

/** Fabricated production wire for codec tests only. No service, readiness or calibration claim. */
export async function decisionWireFixture(request: DecisionRequest, nativeAnswer?: unknown): Promise<DecisionResult> {
  const f = decisionServiceFixture();
  if (nativeAnswer !== undefined) f.transport.send.mockResolvedValue({ ok: true, body: jevResponse(nativeAnswer) });
  const auth = await f.options.resolveAuth({ providerId: 'typesafe', modelId: f.descriptor.wireModel });
  const result = await f.adapter.decision(request, { auth });
  const quoted = quoteDecision(request, f.descriptor, decisionPrice());
  if (!result.ok || !quoted.ok) throw new Error('Invalid codec fixture.');
  const execution = beginDecisionExecution(request);
  const priced = priceDecisionUsage(result.usage, quoted.quote);
  Object.assign(execution.receipt, { attempts: 1, dispatch: 'completed', usage: result.usage,
    servedEvaluator: result.servedEvaluator, servedModelId: result.servedModelId,
    cost: priced.cost, retention: f.descriptor.retention,
    budget: { state: 'settled', reservedMicroUsd: quoted.quote.reservedMicroUsd, overrun: false } });
  closeDecisionReceipt(execution);
  return { kind: 'verdict', ok: true, verdict: result.verdict, receipt: execution.receipt };
}
