import type { JudgeError } from './errors.js';
import { createJudgeError } from './errors.js';
import type { JudgeReceipt, JudgeResult } from './receipt.js';
import { resolveJudgeCorrelationId, unreportedJudgeUsage } from './receipt.js';
import { parseJudgeRequest } from './request.js';
import { isCorrelationId } from './validation.js';
import { freezeJudgeData } from './descriptor-validation.js';
import type { JudgeVerdict } from './verdict.js';
import type { JudgeReceiptSink } from './budget.js';

export interface JudgeClock { wall(): number; monotonic(): number }
export interface JudgeExecution {
  receipt: JudgeReceipt; clock: JudgeClock; start: number; deadline: number; signal?: AbortSignal; idError: boolean;
  phase: JudgeError['phase']; expired: boolean;
}
export const defaultJudgeClock: JudgeClock = { wall: () => Date.now(), monotonic: () => performance.now() };

export function beginJudgeExecution(candidate: unknown, options: { clock?: JudgeClock; generateId?: () => string;
  signal?: AbortSignal; timeoutMs?: number }): JudgeExecution {
  const clock = options.clock ?? defaultJudgeClock;
  const start = clock.monotonic();
  const parsed = parseJudgeRequest(candidate);
  const generate = options.generateId ?? (() => globalThis.crypto.randomUUID());
  let callId: string | null = null;
  let correlationId: string | null = null;
  try { callId = generate(); correlationId = resolveJudgeCorrelationId(parsed.ok ? parsed.request.correlationId : undefined, generate); }
  catch { /* Failed metadata generation is a typed refusal, with safe mandatory IDs. */ }
  const idError = !isCorrelationId(callId) || correlationId === null;
  const receipt: JudgeReceipt = { schemaVersion: 1,
    callId: isCorrelationId(callId) ? callId : globalThis.crypto.randomUUID(),
    correlationId: correlationId ?? globalThis.crypto.randomUUID(), evaluator: parsed.ok ? parsed.request.evaluator : null,
    servedEvaluator: null, servedModelId: null, startedAt: new Date(clock.wall()).toISOString(),
    finishedAt: new Date(clock.wall()).toISOString(), latencyMs: 0, dispatch: 'not-started', attempts: 0,
    usage: unreportedJudgeUsage('not-dispatched'), cost: { status: 'not-incurred', amountMicroUsd: '0', source: 'no-dispatch' },
    retention: { status: 'not-evaluated', basis: 'none', evidenceRefs: [], retentionDays: null },
    budget: { state: 'not-admitted', overrun: false }, outcome: 'error' };
  const timeout = Math.min(parsed.ok ? parsed.request.policy?.timeoutMs ?? 10000 : 10000, options.timeoutMs ?? 60000);
  return { receipt, clock, start, deadline: start + timeout, signal: options.signal, idError, phase: 'preflight', expired: false };
}

export function judgeInterruption(execution: JudgeExecution, phase: JudgeError['phase']): JudgeError | null {
  return (execution.expired || execution.clock.monotonic() >= execution.deadline)
    ? createJudgeError('TIMEOUT', phase)
    : execution.signal?.aborted ? createJudgeError('CANCELLED', phase) : null;
}
export function closeJudgeReceipt(execution: JudgeExecution, error?: JudgeError): void {
  const receipt = execution.receipt;
  receipt.finishedAt = new Date(execution.clock.wall()).toISOString();
  receipt.latencyMs = Math.max(0, execution.clock.monotonic() - execution.start);
  receipt.outcome = error ? 'error' : 'verdict';
  if (error) receipt.errorCode = error.code;
  else delete receipt.errorCode;
}

/** Copies before crossing host boundaries: no live provider envelope or caller content. */
export function copyJudgeReceipt(receipt: JudgeReceipt): JudgeReceipt { return freezeJudgeData(structuredClone(receipt)); }
export async function persistJudgeResult(execution: JudgeExecution, sink: JudgeReceiptSink,
  error?: JudgeError, verdict?: JudgeVerdict): Promise<JudgeResult> {
  execution.phase = 'settlement';
  const settledVerdict = Boolean(verdict && execution.receipt.budget.state === 'settled'
    && (!error || ['TIMEOUT', 'CANCELLED'].includes(error.code)));
  closeJudgeReceipt(execution, settledVerdict ? undefined : error);
  try { await sink.persist(copyJudgeReceipt(execution.receipt)); }
  catch { error = createJudgeError('RECEIPT_UNAVAILABLE', 'settlement'); }
  // Persistence can complete after the caller's deadline; accounting is never replayed.
  error ??= judgeInterruption(execution, execution.receipt.attempts ? 'settlement' : 'preflight') ?? undefined;
  if (error) {
    if (execution.receipt.attempts && ['RECEIPT_UNAVAILABLE', 'TIMEOUT', 'CANCELLED'].includes(error.code)) {
      if (error.code === 'RECEIPT_UNAVAILABLE') {
        execution.receipt.budget.state = 'pending-reconciliation';
      }
    }
    if (!settledVerdict || error.code === 'RECEIPT_UNAVAILABLE') {
      closeJudgeReceipt(execution, error);
    }
    return { kind: 'error', ok: false, error, receipt: copyJudgeReceipt(execution.receipt) };
  }
  if (!verdict) throw new Error('Judge result requires validated evidence.');
  return { kind: 'verdict', ok: true, verdict, receipt: copyJudgeReceipt(execution.receipt) };
}
