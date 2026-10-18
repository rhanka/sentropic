/** A06 confirmation verification against complete current host expectations. */
import { isValidInstant } from './contracts.js';
import { checkFrozenConfirmation } from './confirmation-guard.js';
import type { ExpectedConfirmationContinuationBindingV1, MemoryConfirmationContinuationV1 } from './frozen-confirmation.js';
export type { MemoryConfirmationAssuranceV1, MemoryConfirmationContinuationV1 } from './frozen-confirmation.js';
export type ConfirmationCheckInput = { continuation: MemoryConfirmationContinuationV1; expected: ExpectedConfirmationContinuationBindingV1 };

export function checkOperationConfirmation(input: ConfirmationCheckInput): string[] {
  return checkFrozenConfirmation(input?.continuation, input?.expected);
}

export function isWithinExecutionBudget(confirmedAtIso: string, nowIso: string): boolean {
  if (!isValidInstant(confirmedAtIso) || !isValidInstant(nowIso)) return false;
  const elapsed = Date.parse(nowIso) - Date.parse(confirmedAtIso);
  return elapsed >= 0 && elapsed <= 30000;
}
