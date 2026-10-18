/**
 * MCP-L5 Lot 1 — confirmation assurance and continuation contracts (M4/A06).
 *
 * `MemoryConfirmationAssuranceV1` and `MemoryConfirmationContinuationV1`
 * bind the enrollment/issuer/subject receipt, verified 2FA assurance
 * receipt and its policy version, approving human, delegation, initiating
 * principal, tenant, agent, client, session, attachment, provider/connector,
 * store, scope, tool/version, target, reservation and stable operation
 * digest. Trusted host records, never tool arguments.
 *
 * Confirmation precedes the first canonical effect, is affirmative
 * (literal `true`), unexpired (`now < expires_at`, at most 300 s TTL) and
 * execution is bounded to 30 s plus any earlier deadline.
 */

import {
  MEMORY_CONFIRMATION_TTL_SECONDS,
  MEMORY_EXECUTION_BUDGET_SECONDS,
  isValidDigest,
  isValidInstant,
  isValidOpaqueRef,
} from './contracts.js';
import { isLiteralTrueVerdict } from './invocation-context.js';

/** Verified enrollment/assurance receipt for one operation-bound approval. */
export type MemoryConfirmationAssuranceV1 = {
  issuer: string;
  subject: string;
  enrollmentReceipt: string;
  assuranceReceipt: string;
  assurancePolicyVersion: string;
  approverRef: string;
  delegationRef: string | null;
  initiatingPrincipalRef: string;
  tenantRef: string;
  agentRef: string;
  clientRef: string;
  logicalSessionRef: string;
  attachmentGeneration: string;
  providerRef: string;
  connectorInstanceRef: string;
  storeRef: string;
  scopeRef: string;
  toolName: 'engram_memory_withdraw' | 'engram_memory_forget';
  toolVersion: string;
  targetRef: string;
  reservationRef: string;
  operationDigest: string;
  issuedAt: string;
  expiresAt: string;
};

/** Durable link between a pending reservation, its elicitation and approval. */
export type MemoryConfirmationContinuationV1 = {
  reservationRef: string;
  elicitationRef: string;
  assuranceRef: string;
  logicalSessionRef: string;
  attachmentGeneration: string;
  toolName: 'engram_memory_withdraw' | 'engram_memory_forget';
  targetRef: string;
  operationDigest: string;
  approved: true;
  confirmedAt: string;
};

export type ConfirmationCheckInput = {
  assurance: MemoryConfirmationAssuranceV1;
  continuation: MemoryConfirmationContinuationV1;
  capability: 'engram_memory_withdraw' | 'engram_memory_forget';
  targetRef: string;
  operationDigest: string;
  logicalSessionRef: string;
  nowIso: string;
};

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
