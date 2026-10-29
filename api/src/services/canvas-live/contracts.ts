// H1 preparation shapes from frozen DS §5.7. Replace with published CL-1M imports
// at the adapter boundary before claiming production type conformance (H3 gate).
export interface CollaborationActor {
  actorId: string; kind: 'human' | 'agent' | 'nhi'; displayLabel: string; color: string;
}
export interface FieldBindingIdentity { documentId: string; sessionId: string; fieldKey: string }
export interface OpenSessionInput {
  binding: Omit<FieldBindingIdentity, 'sessionId'> & { sessionId?: string };
  actor: CollaborationActor; profileId: string; schemaEpoch: string;
}
export class AdmissionError extends Error {
  constructor(readonly code: 'scope-denied' | 'actor-denied' | 'revoked' | 'incompatible-schema' | 'invalid-binding') {
    super(code);
  }
}
