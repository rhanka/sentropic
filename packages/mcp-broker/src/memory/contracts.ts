/**
 * MCP-L5 Lot 1 — broker memory contract entry (frozen subset).
 *
 * Pure frozen contract entry: re-exported L4-consumed platform memory
 * types plus the broker's closed source-binding and dispatch-selection
 * records. No runtime import of a cluster-mesh source path, no mock or
 * in-memory authority.
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
} from '@sentropic/mcp-platform/memory';

/**
 * Closed source binding for one memory dispatch: exact provider, connector,
 * catalog source, connector instance and active generation. Same-named
 * tools, changed sourceId, substituted provider/connector or stale
 * generation never select another handler.
 */
export type MemorySourceBindingV1 = {
  providerId: 'sentropic.engram.memory';
  connectorId: 'engram-memory';
  sourceId: string;
  connectorInstanceRef: string;
  generation: string;
};

/**
 * Closed dispatch selection returned before provider invocation: the exact
 * planned capability, its verified source binding and the neutral context
 * projection the provider receives.
 */
export type MemoryDispatchSelectionV1 = {
  capabilityName: string;
  providerId: string;
  sourceBinding: MemorySourceBindingV1;
  requiredScopes: string[];
  requiredClaims: string[];
  confirmationRequired: boolean;
};
