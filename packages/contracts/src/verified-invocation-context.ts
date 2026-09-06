export type VerifiedPrincipalKind = 'human' | 'workload';

export interface VerifiedPrincipalRef {
  readonly principalId: string;
  readonly kind: VerifiedPrincipalKind;
  readonly verifierId: string;
}

export interface VerifiedWorkspaceBindingRef {
  readonly bindingId: string;
  readonly workspaceId: string;
  readonly revision: string;
}

export interface VerifiedRegistrationRef {
  readonly registrationId: string;
  readonly generationId: string;
  readonly workspaceId: string;
  readonly actuatorRef: string;
  readonly custodyEpoch: number;
  readonly expiresAt: string;
}

export interface VerifiedCustodyRef {
  readonly custodyId: string;
  readonly holderPrincipalId: string;
  readonly epoch: number;
}

export interface VerifiedInvocationContext {
  readonly invocationId: string;
  readonly correlationId: string;
  readonly generationId: string;
  readonly principal: VerifiedPrincipalRef;
  readonly workspace: VerifiedWorkspaceBindingRef;
  readonly scopes: readonly string[];
  readonly policyRevision: string;
  readonly registration?: VerifiedRegistrationRef;
  readonly custody?: VerifiedCustodyRef;
  readonly issuedAt: string;
}

export interface VerifiedInvocationContextRequest {
  readonly invocationId: string;
  readonly correlationId: string;
  readonly generationId: string;
  readonly method: string;
  readonly path: string;
  readonly targetRegistrationId?: string;
  readonly idempotencyKey?: string;
  readonly receiptStages?: readonly ['transported', 'verified', 'acted'];
  readonly authorizationEvidenceRef?: string;
}

export interface VerifiedInvocationContextPort {
  verify(input: VerifiedInvocationContextRequest): Promise<VerifiedInvocationContext>;
}
