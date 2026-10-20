/**
 * `@sentropic/mcp-broker/memory` — pure frozen memory contract entry.
 *
 * Re-exported L4-consumed memory types plus the broker's closed
 * source-binding records and verified compiled dispatch. No mock,
 * in-memory or sibling-source authority.
 */

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
  MemoryInvocationBindingV1,
  MemoryContextProjectionV1,
  MemoryConfirmationAssuranceV1,
  MemoryConfirmationContinuationV1,
  ConfirmationCheckInput,
  MemorySourceBindingV1,
  MemoryDispatchSelectionV1,
} from './contracts.js';

export {
  bindMemoryInvocation,
  projectMemoryContext,
  requireTrustedInvocationContext,
} from './context-projection.js';
export type {
  BindMemoryInvocationInput,
  BoundMemoryInvocationV1,
} from './context-projection.js';

export {
  MemoryDispatchRefusal,
  CompiledMemoryDispatch,
} from './compiled-dispatch.js';
export type {
  MemoryDispatchRefusalCode,
  CompiledMemoryDispatchOptions,
  SelectMemoryToolInput,
  SelectedMemoryToolV1,
} from './compiled-dispatch.js';
