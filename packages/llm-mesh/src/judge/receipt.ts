import type { JudgeError, JudgeErrorCode } from './errors.js';
import type { EvaluatorRef, JudgeRequest, MicroUsd } from './request.js';
import type { JudgeVerdict } from './verdict.js';
import { isCorrelationId } from './validation.js';

export type TokenCounter =
  | { value: number; source: 'provider' }
  | { value: null; source: 'not-reported' };
export type TotalTokenCounter = TokenCounter | { value: number; source: 'derived-sum' };

export interface JudgeUsage {
  tokens: { input: TokenCounter; output: TokenCounter; total: TotalTokenCounter };
  evaluatorCalls: number | null;
  explanations: number | null;
}

export type JudgeCost =
  | { status: 'actual'; amountMicroUsd: MicroUsd; source: 'provider';
      priceRevision?: string; rounding: 'ceil-micro-usd' }
  | { status: 'estimated'; amountMicroUsd: MicroUsd;
      source: 'reported-usage-times-rate' | 'call-rate' | 'reserved-liability';
      priceRevision: string; rounding: 'ceil-micro-usd' }
  | { status: 'not-incurred'; amountMicroUsd: '0'; source: 'no-dispatch' };

export interface RetentionReceipt {
  status: 'non-zdr' | 'unknown' | 'not-evaluated';
  basis: 'published-policy' | 'none';
  evidenceRefs: readonly string[];
  retentionDays: number | null;
  gap?: 'unknown (source-gap)';
}

export interface JudgeReceipt {
  schemaVersion: 1;
  callId: string;
  correlationId: string;
  evaluator: EvaluatorRef | null;
  servedEvaluator: EvaluatorRef | null;
  servedModelId: string | null;
  providerRequestId?: string;
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
  providerLatencyMs?: number;
  dispatch: 'not-started' | 'started' | 'completed' | 'unknown';
  attempts: 0 | 1;
  usage: JudgeUsage;
  cost: JudgeCost;
  retention: RetentionReceipt;
  budget: { state: 'not-admitted' | 'released' | 'settled' | 'pending-reconciliation';
    reservedMicroUsd?: MicroUsd; overrun: boolean };
  outcome: 'verdict' | 'error';
  errorCode?: JudgeErrorCode;
}

export type JudgeResult =
  | { kind: 'verdict'; ok: true; verdict: JudgeVerdict; receipt: JudgeReceipt }
  | { kind: 'error'; ok: false; error: JudgeError; receipt: JudgeReceipt };

export interface JudgeClient {
  judge(request: JudgeRequest, options?: { signal?: AbortSignal }): Promise<JudgeResult>;
}

export interface JudgeConnectionFailure {
  kind: 'connection-failure';
  ok: false;
  error: JudgeError & { code: 'MESH_UNAVAILABLE' | 'TRANSPORT_FAILED' | 'TIMEOUT' | 'CANCELLED' };
  receipt: null;
  usage: JudgeUsage;
  callStatus: 'not-sent' | 'unknown';
  correlationId: string;
}

export interface RemoteJudgeClient {
  judge(request: JudgeRequest, options?: { signal?: AbortSignal }): Promise<JudgeResult | JudgeConnectionFailure>;
}

/** Unknown counters stay null even when no dispatch proves zero evaluator calls. */
export function unreportedJudgeUsage(execution: 'not-dispatched' | 'unknown'): JudgeUsage {
  return { tokens: { input: { value: null, source: 'not-reported' },
    output: { value: null, source: 'not-reported' }, total: { value: null, source: 'not-reported' } },
    evaluatorCalls: execution === 'not-dispatched' ? 0 : null,
    explanations: execution === 'not-dispatched' ? 0 : null };
}

/** Correlation is metadata, never financial idempotency or caller authority. */
export function resolveJudgeCorrelationId(value: string | undefined,
  generate: () => string = () => globalThis.crypto.randomUUID()): string | null {
  const candidate = value === undefined ? generate() : value;
  return isCorrelationId(candidate) ? candidate : null;
}
