/** A06 confirmation verification against complete current host expectations. */
import { isValidInstant } from './contracts.js';
import { checkFrozenConfirmation } from './confirmation-guard.js';
import type { ConfirmationContinuationDecisionV1, ExpectedConfirmationContinuationBindingV1, MemoryConfirmationContinuationV1 } from './frozen-confirmation.js';
export type { MemoryConfirmationAssuranceV1, MemoryConfirmationContinuationV1 } from './frozen-confirmation.js';
export type ConfirmationCheckInput = { continuation: MemoryConfirmationContinuationV1; expected: ExpectedConfirmationContinuationBindingV1 };

export function checkOperationConfirmation(input: ConfirmationCheckInput): string[] {
  if (input?.expected?.reservation_state === 'committed') return ['confirmation: committed disclosure cannot authorize a repeat effect'];
  return checkFrozenConfirmation(input?.continuation, input?.expected);
}

/** A06 distinguishes fresh effect authorization from committed result disclosure. */
export function verifyMemoryConfirmationContinuationV1(
  continuation: unknown, expected: ExpectedConfirmationContinuationBindingV1,
): ConfirmationContinuationDecisionV1 {
  const failures = checkFrozenConfirmation(continuation as MemoryConfirmationContinuationV1, expected);
  if (!failures.length) return { ok: true, decision: expected.reservation_state === 'committed'
    ? 'disclose_committed_without_repeat_effect' : 'execute_confirmed', continuation: continuation as MemoryConfirmationContinuationV1 };
  const error_code = expected?.caller_currently_authorized !== true ? 'UNAUTHORIZED'
    : expected?.target_currently_authorized !== true ? 'NOT_FOUND'
    : expected?.reservation_state === 'unknown' ? 'MUTATION_OUTCOME_UNKNOWN' : 'gate_failed';
  return { ok: false, error_code, reason: failures.join('; ') };
}

export function isWithinExecutionBudget(confirmedAtIso: string, nowIso: string): boolean {
  if (!isValidInstant(confirmedAtIso) || !isValidInstant(nowIso)) return false;
  const elapsed = Date.parse(nowIso) - Date.parse(confirmedAtIso);
  return elapsed >= 0 && elapsed <= 30000;
}
