import type { DecisionErrorCode } from './errors.js';
import { createDecisionError } from './errors.js';
import type { DecisionExecution } from './execution.js';
import { copyDecisionReceipt } from './execution.js';
import type { DecisionReceipt, DecisionResult } from './receipt.js';

function interruptedResult(execution: DecisionExecution, code: DecisionErrorCode): DecisionResult {
  const error = execution.phase === 'settlement' ? createDecisionError(code, 'settlement')
    : execution.phase === 'dispatch' ? createDecisionError(code, 'dispatch')
      : execution.phase === 'admission' ? createDecisionError(code, 'admission')
        : execution.phase === 'parse' ? createDecisionError(code, 'parse') : createDecisionError(code, 'preflight');
  const receipt: DecisionReceipt = structuredClone(execution.receipt);
  if (receipt.budget.state !== 'not-admitted' && receipt.budget.state !== 'released') {
    receipt.budget.state = 'pending-reconciliation';
    error.retryable = false;
    delete error.retryAfterMs;
  }
  if (receipt.dispatch === 'started') receipt.dispatch = 'unknown';
  receipt.finishedAt = new Date(execution.clock.wall()).toISOString();
  receipt.latencyMs = Math.max(0, execution.clock.monotonic() - execution.start);
  receipt.outcome = 'error';
  receipt.errorCode = error.code;
  return { kind: 'error', ok: false, error, receipt: copyDecisionReceipt(receipt) };
}

/** The caller has a bounded wait even when a host ignores cancellation. The one
 * worker continues accounting on late acknowledgements, fenced by the same callId;
 * its expired/aborted signal forbids a later provider dispatch. It never re-evaluates.
 */
export async function runWithDecisionDeadline(execution: DecisionExecution, work: () => Promise<DecisionResult>): Promise<DecisionResult> {
  const caller = execution.signal;
  const controller = new AbortController();
  execution.signal = controller.signal;
  let resolve!: (result: DecisionResult) => void;
  const interruption = new Promise<DecisionResult>((done) => { resolve = done; });
  let finished = false;
  const stop = (code: 'TIMEOUT' | 'CANCELLED') => {
    if (finished) return;
    execution.expired = code === 'TIMEOUT';
    controller.abort();
    resolve(interruptedResult(execution, code));
  };
  const onCancel = () => stop('CANCELLED');
  const timer = setTimeout(() => stop('TIMEOUT'), Math.max(0, execution.deadline - execution.clock.monotonic()));
  caller?.addEventListener('abort', onCancel, { once: true });
  if (caller?.aborted) onCancel();
  // Attach rejection handling immediately; late financial work must not leak exceptions.
  const working = work().catch(() => interruptedResult(execution, 'MESH_UNAVAILABLE'));
  try { return await Promise.race([working, interruption]); }
  finally { finished = true; clearTimeout(timer); caller?.removeEventListener('abort', onCancel); }
}
