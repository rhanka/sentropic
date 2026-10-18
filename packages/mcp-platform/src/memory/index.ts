/**
 * `@sentropic/mcp-platform/memory` — frozen production memory contracts.
 *
 * L4-consumed types and schemas only: tool names, closed envelopes, the M5
 * mutation preimage and digest profile, confirmation assurance/continuation
 * and verified invocation context/projection. Pure surface: no mock,
 * testing, experimental, store or sibling-source imports. The platform root
 * entry never loads this module implicitly.
 */

export {
  MEMORY_WIRE_PROFILE_ID,
  MEMORY_TOOLS_PROFILE_ID,
  MEMORY_MUTATION_DIGEST_PROFILE_ID,
  MEMORY_PROVIDER_ID,
  MEMORY_CONNECTOR_ID,
  MEMORY_PROVIDER_CONTRACT_VERSION,
  MEMORY_PAYLOAD_SCHEMA_VERSION,
  MEMORY_TOOL_NAMES,
  MUTATING_MEMORY_TOOL_NAMES,
  isMemoryToolName,
  isMutatingMemoryToolName,
  utf8ByteLength,
  isNfc,
  isWellFormed,
  isValidOpaqueRef,
  isValidIdempotencyKey,
  isValidDigest,
  isValidCursor,
  isValidInstant,
  MEMORY_DEFAULT_MAX_PACKET_BYTES,
  MEMORY_MIN_MAX_PACKET_BYTES,
  MEMORY_MAX_MAX_PACKET_BYTES,
  MEMORY_COMBINED_RESULT_CEILING_BYTES,
  MEMORY_CONFIRMATION_TTL_SECONDS,
  MEMORY_EXECUTION_BUDGET_SECONDS,
  isPublicMemoryErrorCode,
  TRUSTED_CONTEXT_PROTOCOL_ERROR_CODE,
  TRUSTED_CONTEXT_UNAVAILABLE_MESSAGE,
  FORBIDDEN_SYNTHETIC_AUDIT_ID,
  MemoryConfirmationRequestV1Schema,
  MemoryConfirmationResponseV1Schema,
  MEMORY_TOOLS,
  findMemoryTool,
} from './contracts.js';
export type {
  MemoryToolName,
  MutatingMemoryToolName,
  MemoryToolSuccessV1,
  MemoryToolFailureV1,
  MemoryToolEnvelopeV1,
  PublicMemoryErrorCode,
  MemoryMutationTargetV1,
  EffectiveMemoryMutationInputV1,
  MemoryMutationPolicyVersionsV1,
  MemoryMutationPreimageV1,
  MemoryReservationLookupKeyV1,
} from './contracts.js';

export {
  MemoryTrustedContextError,
  isLiteralTrueVerdict,
  requireTrustedInvocationContext,
  projectMemoryContext,
  validateMemoryProjection,
} from './invocation-context.js';
export type {
  MemoryInvocationBindingV1,
  MemoryContextProjectionV1,
} from './invocation-context.js';

export {
  sha256HexBytes,
  validateEffectiveInput,
  validateMutationTarget,
  validateMutationPreimage,
  computeMutationDigest,
  reservationLookupKey,
  checkSameKeyBinding,
  validatePolicyVersionsProjection,
} from './mutation-guard.js';
export type { SameKeyOutcome } from './mutation-guard.js';

export {
  checkOperationConfirmation,
  isWithinExecutionBudget,
} from './confirmation.js';
export type {
  MemoryConfirmationAssuranceV1,
  MemoryConfirmationContinuationV1,
  ConfirmationCheckInput,
} from './confirmation.js';
