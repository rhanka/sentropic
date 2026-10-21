import type { DecisionError } from './errors.js';
import { createDecisionError } from './errors.js';
import type { DecisionReceipt, DecisionResult } from './receipt.js';
import { resolveDecisionCorrelationId, unreportedDecisionUsage } from './receipt.js';
import { parseDecisionRequest } from './request.js';
import { isCorrelationId } from './validation.js';
import { freezeDecisionData } from './descriptor-validation.js';
import type { DecisionVerdict } from './verdict.js';
import type { DecisionReceiptSink } from './budget.js';

export interface DecisionClock { wall(): number; monotonic(): number }
export interface DecisionExecution {
  receipt: DecisionReceipt; clock: DecisionClock; start: number; deadline: number; signal?: AbortSignal; idError: boolean;
  phase: DecisionError['phase']; expired: boolean;
}
export const defaultDecisionClock: DecisionClock = { wall: () => Date.now(), monotonic: () => performance.now() };

export function beginDecisionExecution(candidate: unknown, options: { clock?: DecisionClock; generateId?: () => string;
  signal?: AbortSignal; timeoutMs?: number }): DecisionExecution {
  const clock = options.clock ?? defaultDecisionClock;
  const start = clock.monotonic();
  const parsed = parseDecisionRequest(candidate);
  const generate = options.generateId ?? (() => globalThis.crypto.randomUUID());
  let callId: string | null = null;
  let correlationId: string | null = null;
  try { callId = generate(); correlationId = resolveDecisionCorrelationId(parsed.ok ? parsed.request.correlationId : undefined, generate); }
  catch { /* Failed metadata generation is a typed refusal, with safe mandatory IDs. */ }
  const idError = !isCorrelationId(callId) || correlationId === null;
  const receipt: DecisionReceipt = { schemaVersion: 1,
    callId: isCorrelationId(callId) ? callId : globalThis.crypto.randomUUID(),
    correlationId: correlationId ?? globalThis.crypto.randomUUID(), evaluator: parsed.ok ? parsed.request.evaluator : null,
    servedEvaluator: null, servedModelId: null, startedAt: new Date(clock.wall()).toISOString(),
    finishedAt: new Date(clock.wall()).toISOString(), latencyMs: 0, dispatch: 'not-started', attempts: 0,
    usage: unreportedDecisionUsage('not-dispatched'), cost: { status: 'not-incurred', amountMicroUsd: '0', source: 'no-dispatch' },
    retention: { status: 'not-evaluated', basis: 'none', evidenceRefs: [], retentionDays: null },
    budget: { state: 'not-admitted', overrun: false }, outcome: 'error' };
  const timeout = Math.min(parsed.ok ? parsed.request.policy?.timeoutMs ?? 10000 : 10000, options.timeoutMs ?? 60000);
  return { receipt, clock, start, deadline: start + timeout, signal: options.signal, idError, phase: 'preflight', expired: false };
}

export function decisionInterruption(execution: DecisionExecution, phase: DecisionError['phase']): DecisionError | null {
  return (execution.expired || execution.clock.monotonic() >= execution.deadline)
    ? createDecisionError('TIMEOUT', phase)
    : execution.signal?.aborted ? createDecisionError('CANCELLED', phase) : null;
}
export function closeDecisionReceipt(execution: DecisionExecution, error?: DecisionError): void {
  const receipt = execution.receipt;
  receipt.finishedAt = new Date(execution.clock.wall()).toISOString();
  receipt.latencyMs = Math.max(0, execution.clock.monotonic() - execution.start);
  receipt.outcome = error ? 'error' : 'verdict';
  if (error) receipt.errorCode = error.code;
  else delete receipt.errorCode;
}

/** Copies before crossing host boundaries: no live provider envelope or caller content. */
export function copyDecisionReceipt(receipt: DecisionReceipt): DecisionReceipt { return freezeDecisionData(structuredClone(receipt)); }
export async function persistDecisionResult(execution: DecisionExecution, sink: DecisionReceiptSink,
  error?: DecisionError, verdict?: DecisionVerdict): Promise<DecisionResult> {
  execution.phase = 'settlement';
  if (error) closeDecisionReceipt(execution, error);
  try { await sink.persist(copyDecisionReceipt(execution.receipt)); }
  catch {
    error = createDecisionError('RECEIPT_UNAVAILABLE', 'settlement');
    if (execution.receipt.attempts) execution.receipt.budget.state = 'pending-reconciliation';
    closeDecisionReceipt(execution, error);
  }
  // Persistence can complete after the caller's deadline; accounting is never replayed.
  const interrupted = !error ? decisionInterruption(execution, execution.receipt.attempts ? 'settlement' : 'preflight') : null;
  if (interrupted) {
    error = interrupted;
    if (execution.receipt.budget.state !== 'not-admitted' && execution.receipt.budget.state !== 'released') {
      execution.receipt.budget.state = 'pending-reconciliation';
      error.retryable = false;
      delete error.retryAfterMs;
    }
  }
  if (error) {
    closeDecisionReceipt(execution, error);
    return { kind: 'error', ok: false, error, receipt: copyDecisionReceipt(execution.receipt) };
  }
  if (!verdict) throw new Error('Decision result requires validated evidence.');
  return { kind: 'verdict', ok: true, verdict, receipt: copyDecisionReceipt(execution.receipt) };
}
