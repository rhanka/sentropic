import { has } from './validation.js';

const messages = {
  REQUEST_INVALID: 'Invalid judge request.',
  PROVIDER_UNKNOWN: 'Unknown judge provider.',
  EVALUATOR_UNKNOWN: 'Unknown evaluator.',
  CAPABILITY_UNSUPPORTED: 'Requested judge capability is unsupported.',
  PROVIDER_UNAVAILABLE: 'Judge provider is unavailable.',
  REVISION_MISMATCH: 'Evaluator revision does not match.',
  CREDENTIAL_MISSING: 'Judge credential is missing.',
  AUTHENTICATION_FAILED: 'Authentication failed.',
  AUTHORIZATION_DENIED: 'Judge authorization denied.',
  PRICING_UNAVAILABLE: 'Judge pricing is unavailable.',
  BUDGET_BOUND_UNAVAILABLE: 'A finite judge liability bound is unavailable.',
  BUDGET_EXHAUSTED: 'Judge budget is exhausted.',
  BUDGET_UNAVAILABLE: 'Judge budget authority is unavailable.',
  SETTLEMENT_UNAVAILABLE: 'Judge settlement is unavailable.',
  RATE_LIMITED: 'Judge provider rate limit reached.',
  PROVIDER_OVERLOADED: 'Judge provider is overloaded.',
  PROVIDER_REJECTED: 'Judge provider rejected the request.',
  TIMEOUT: 'Judge deadline exceeded.',
  CANCELLED: 'Judge invocation cancelled.',
  TRANSPORT_FAILED: 'Judge transport failed.',
  VERDICT_INVALID: 'Invalid judge verdict.',
  SERVED_IDENTITY_MISMATCH: 'Served evaluator identity does not match.',
  USAGE_INVALID: 'Invalid judge usage.',
  RESPONSE_TOO_LARGE: 'Judge response exceeds its size limit.',
  RECEIPT_UNAVAILABLE: 'Judge receipt persistence is unavailable.',
  MESH_UNAVAILABLE: 'Judge mesh is unavailable.',
} as const;

export type JudgeErrorCode = keyof typeof messages;
export interface JudgeError {
  code: JudgeErrorCode;
  message: string;
  phase: 'preflight' | 'admission' | 'dispatch' | 'parse' | 'settlement';
  retryable: boolean;
  retryAfterMs?: number;
}

export const isJudgeErrorCode = (value: unknown): value is JudgeErrorCode =>
  typeof value === 'string' && has(messages, value);

// Advisory delay ceiling matches the maximum judge request deadline.
const maxRetryAfterMs = 60_000;

/** Static wording only. Retry hints never authorize replay or evaluator substitution. */
export function createJudgeError(code: JudgeErrorCode, phase: JudgeError['phase'],
  options: { retryAfterMs?: number } = {}): JudgeError {
  const safeCode = isJudgeErrorCode(code) ? code : 'REQUEST_INVALID';
  const safePhase = ['preflight', 'admission', 'dispatch', 'parse', 'settlement'].includes(phase) ? phase : 'preflight';
  const financialUnavailable = ['BUDGET_UNAVAILABLE', 'SETTLEMENT_UNAVAILABLE', 'RECEIPT_UNAVAILABLE'].includes(safeCode);
  const retryable = phase === safePhase && safePhase !== 'settlement' && (financialUnavailable
    ? safePhase === 'preflight' || safePhase === 'admission'
    : ['PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'PROVIDER_OVERLOADED', 'TIMEOUT', 'TRANSPORT_FAILED', 'MESH_UNAVAILABLE'].includes(safeCode));
  const hint = options.retryAfterMs;
  return { code: safeCode, message: messages[safeCode],
    phase: safePhase, retryable,
    ...(retryable && typeof hint === 'number' && Number.isSafeInteger(hint) && hint >= 0
      && hint <= maxRetryAfterMs ? { retryAfterMs: hint } : {}) };
}
