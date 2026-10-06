import type { JudgeErrorCode } from './errors.js';
import { createJudgeError } from './errors.js';
import type { JudgeExecution } from './execution.js';
import { closeJudgeReceipt, copyJudgeReceipt } from './execution.js';
import type { JudgeResult } from './receipt.js';

function interruptedResult(execution: JudgeExecution, code: JudgeErrorCode): JudgeResult {
  const error = execution.phase === 'settlement' ? createJudgeError(code, 'settlement')
    : execution.phase === 'dispatch' ? createJudgeError(code, 'dispatch')
      : execution.phase === 'admission' ? createJudgeError(code, 'admission')
        : execution.phase === 'parse' ? createJudgeError(code, 'parse') : createJudgeError(code, 'preflight');
  const receipt = execution.receipt;
  if (receipt.budget.state !== 'not-admitted' && receipt.budget.state !== 'released') {
    receipt.budget.state = 'pending-reconciliation';
    error.retryable = false;
    delete error.retryAfterMs;
  }
  if (receipt.dispatch === 'started') receipt.dispatch = 'unknown';
  closeJudgeReceipt(execution, error);
  return { kind: 'error', ok: false, error, receipt: copyJudgeReceipt(receipt) };
}

/** The caller has a bounded wait even when a host ignores cancellation. The one
 * worker continues accounting on late acknowledgements, fenced by the same callId;
 * its expired/aborted signal forbids a later provider dispatch. It never re-evaluates.
 */
export async function runWithJudgeDeadline(execution: JudgeExecution, work: () => Promise<JudgeResult>): Promise<JudgeResult> {
  const caller = execution.signal;
  const controller = new AbortController();
  execution.signal = controller.signal;
  let resolve!: (result: JudgeResult) => void;
  const interruption = new Promise<JudgeResult>((done) => { resolve = done; });
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
