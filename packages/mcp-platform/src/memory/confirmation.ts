import {
  MEMORY_CONFIRMATION_TTL_SECONDS,
  MEMORY_EXECUTION_BUDGET_SECONDS,
  isValidDigest,
  isValidInstant,
  isValidOpaqueRef,
} from './contracts.js';
import { isLiteralTrueVerdict } from './invocation-context.js';

import { checkFrozenConfirmation } from './confirmation-guard.js';
import type { ExpectedConfirmationContinuationBindingV1, MemoryConfirmationContinuationV1 } from './frozen-confirmation.js';
export type { MemoryConfirmationAssuranceV1, MemoryConfirmationContinuationV1 } from './frozen-confirmation.js';
export type ConfirmationCheckInput = { continuation: MemoryConfirmationContinuationV1; expected: ExpectedConfirmationContinuationBindingV1 };

/**
 * Verify an operation-bound confirmation at the effect guard. Every check
 * is required: affirmative literal approval, unexpired TTL within the
 * 300 s ceiling, exact capability/target/digest/session binding and
 * execution inside the 30 s budget. Returns failures, empty when the
 * confirmation authorizes the effect.
 */
export function checkOperationConfirmation(input: ConfirmationCheckInput): string[] {
  const failures: string[] = [];
  const { assurance, continuation } = input;
  if (!isLiteralTrueVerdict(continuation.approved)) {
    failures.push('confirmation.approved: affirmative literal true required');
  }
  if (continuation.operationDigest !== input.operationDigest) {
    failures.push('confirmation.operationDigest: must match the sealed operation digest');
  }
  if (!isValidDigest(input.operationDigest)) {
    failures.push('confirmation.operationDigest: invalid digest');
  }
  if (assurance.toolName !== input.capability || continuation.toolName !== input.capability) {
    failures.push('confirmation.capability: must match the authorized tool');
  }
  if (assurance.targetRef !== input.targetRef || continuation.targetRef !== input.targetRef) {
    failures.push('confirmation.targetRef: must match the authorized target');
  }
  if (assurance.logicalSessionRef !== input.logicalSessionRef || continuation.logicalSessionRef !== input.logicalSessionRef) {
    failures.push('confirmation.logicalSessionRef: must match the current logical session');
  }
  if (assurance.reservationRef !== continuation.reservationRef) {
    failures.push('confirmation.reservationRef: assurance and continuation must bind the same reservation');
  }
  if (assurance.operationDigest !== input.operationDigest) {
    failures.push('confirmation.assurance.operationDigest: must match the sealed operation digest');
  }
  if (!isValidInstant(assurance.issuedAt) || !isValidInstant(assurance.expiresAt)) {
    failures.push('confirmation.issuedAt/expiresAt: must be canonical instants');
    return failures;
  }
  const issuedMs = Date.parse(assurance.issuedAt);
  const expiresMs = Date.parse(assurance.expiresAt);
  if (!(expiresMs > issuedMs && expiresMs - issuedMs <= MEMORY_CONFIRMATION_TTL_SECONDS * 1000)) {
    failures.push('confirmation.ttl: must be positive and at most 300 seconds');
  }
  if (!isValidInstant(input.nowIso)) {
    failures.push('confirmation.now: must be a canonical instant');
    return failures;
  }
  const nowMs = Date.parse(input.nowIso);
  if (!(nowMs < expiresMs)) {
    failures.push('confirmation.expiry: now must be strictly before expires_at');
  }
  const confirmedMs = Date.parse(continuation.confirmedAt);
  if (Number.isNaN(confirmedMs) || nowMs - confirmedMs > MEMORY_EXECUTION_BUDGET_SECONDS * 1000) {
    failures.push('confirmation.execution: effect must start within 30 seconds of confirmation');
  }
  if (!isValidOpaqueRef(assurance.approverRef)) {
    failures.push('confirmation.approverRef: invalid OpaqueRef');
  }
  if (!isValidOpaqueRef(assurance.assurancePolicyVersion)) {
    failures.push('confirmation.assurancePolicyVersion: invalid OpaqueRef');
  }
  return failures;
}

/** Execution budget check in isolation: effect start must be within 30 s of confirmation. */
export function isWithinExecutionBudget(confirmedAtIso: string, nowIso: string): boolean {
  const confirmedMs = Date.parse(confirmedAtIso);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(confirmedMs) || Number.isNaN(nowMs)) return false;
  return nowMs - confirmedMs <= MEMORY_EXECUTION_BUDGET_SECONDS * 1000;
}
