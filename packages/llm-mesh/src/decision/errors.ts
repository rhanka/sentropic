import { has } from './validation.js';

const messages = {
  REQUEST_INVALID: 'Invalid decision request.',
  PROVIDER_UNKNOWN: 'Unknown decision provider.',
  EVALUATOR_UNKNOWN: 'Unknown evaluator.',
  CAPABILITY_UNSUPPORTED: 'Requested decision capability is unsupported.',
  PROVIDER_UNAVAILABLE: 'Decision provider is unavailable.',
  REVISION_MISMATCH: 'Evaluator revision does not match.',
  CREDENTIAL_MISSING: 'Decision credential is missing.',
  AUTHENTICATION_FAILED: 'Authentication failed.',
  AUTHORIZATION_DENIED: 'Decision authorization denied.',
  PRICING_UNAVAILABLE: 'Decision pricing is unavailable.',
  BUDGET_BOUND_UNAVAILABLE: 'A finite decision liability bound is unavailable.',
  BUDGET_EXHAUSTED: 'Decision budget is exhausted.',
  BUDGET_UNAVAILABLE: 'Decision budget authority is unavailable.',
  SETTLEMENT_UNAVAILABLE: 'Decision settlement is unavailable.',
  RATE_LIMITED: 'Decision provider rate limit reached.',
  PROVIDER_OVERLOADED: 'Decision provider is overloaded.',
  PROVIDER_REJECTED: 'Decision provider rejected the request.',
  TIMEOUT: 'Decision deadline exceeded.',
  CANCELLED: 'Decision invocation cancelled.',
  TRANSPORT_FAILED: 'Decision transport failed.',
  VERDICT_INVALID: 'Invalid decision verdict.',
  SERVED_IDENTITY_MISMATCH: 'Served evaluator identity does not match.',
  USAGE_INVALID: 'Invalid decision usage.',
  RESPONSE_TOO_LARGE: 'Decision response exceeds its size limit.',
  RECEIPT_UNAVAILABLE: 'Decision receipt persistence is unavailable.',
  MESH_UNAVAILABLE: 'Decision mesh is unavailable.',
} as const;

export type DecisionErrorCode = keyof typeof messages;
export interface DecisionError {
  code: DecisionErrorCode;
  message: string;
  phase: 'preflight' | 'admission' | 'dispatch' | 'parse' | 'settlement';
  retryable: boolean;
  retryAfterMs?: number;
}

export const isDecisionErrorCode = (value: unknown): value is DecisionErrorCode =>
  typeof value === 'string' && has(messages, value);

// Advisory delay ceiling matches the maximum decision request deadline.
const maxRetryAfterMs = 60_000;

/** Static wording only. Retry hints never authorize replay or evaluator substitution. */
export function createDecisionError(code: DecisionErrorCode, phase: DecisionError['phase'],
  options: { retryAfterMs?: number } = {}): DecisionError {
  const safeCode = isDecisionErrorCode(code) ? code : 'REQUEST_INVALID';
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
