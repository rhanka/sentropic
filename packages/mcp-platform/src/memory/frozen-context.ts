/** Co-frozen A03 declarations from Engram 60a8bfa8 policy.ts. */
type OpaqueRef = string;
type Digest = `sha256:${string}`;
type Instant = string;
type Cursor = string;
type AuthorizationContextV1 = { readonly credential: string; readonly context_ref?: OpaqueRef };
export type ChannelBindingKindV1 = 'in_process_verified' | 'stdio_host_managed_verified' |
  'http_mcp_auth_dpop_verified' | 'http_mcp_auth_bearer_verified';
export interface DelegationBindingV1 {
  readonly delegator_principal_id: OpaqueRef;
  readonly delegate_principal_id: OpaqueRef;
  readonly delegation_receipt_digest: Digest;
  readonly verified_by_host_resolver: boolean;
  readonly expires_at: Instant;
}
export interface TrustedInvocationContextV1 {
  readonly principal_id: OpaqueRef;
  readonly principal_namespace: OpaqueRef;
  readonly tenant_id: OpaqueRef;
  readonly store_id: OpaqueRef;
  readonly connector_id: 'engram-memory';
  readonly scope_ref: OpaqueRef;
  readonly mcp_client_id: OpaqueRef;
  readonly session_id: OpaqueRef;
  readonly correlation_id: OpaqueRef;
  readonly now_utc: Instant;
  readonly deadline_ms: number;
  readonly authorization_context: AuthorizationContextV1;
  readonly policy_epoch?: Cursor;
  readonly trust_epoch?: Cursor;
  readonly authorization_receipt_digest?: Digest;
  readonly authorization_issued_at?: Instant;
  readonly authorization_expires_at?: Instant;
}
export interface MemoryInvocationBindingV1 {
  readonly issuer: OpaqueRef;
  readonly sub: OpaqueRef;
  readonly tid: OpaqueRef;
  readonly claims: readonly string[];
  readonly claims_provenance_receipt: Digest;
  readonly principal_namespace: OpaqueRef;
  readonly principal_id: OpaqueRef;
  readonly tenant_id: OpaqueRef;
  readonly tenant_membership_receipt: Digest;
  readonly tenant_resolution_source: 'authoritative_membership';
  readonly workspace_id?: OpaqueRef;
  readonly agent_id: OpaqueRef;
  readonly mcp_client_id: OpaqueRef;
  readonly logical_session_ref: OpaqueRef;
  readonly transport_attachment_ref: OpaqueRef;
  readonly connection_proof_digest: Digest;
  readonly publisher_id: 'sentropic.engram.memory';
  readonly provider_id: 'sentropic.engram.memory';
  readonly connector_id: 'engram-memory';
  readonly connector_instance_ref: OpaqueRef;
  readonly selected_source_id: 'mcp:engram-memory';
  readonly store_id: OpaqueRef;
  readonly scope_ref: OpaqueRef;
  readonly purpose_ref: OpaqueRef;
  readonly active_generation: Cursor;
  readonly policy_epoch: Cursor;
  readonly audit_id: OpaqueRef;
  readonly correlation_ref: OpaqueRef;
  readonly deadline_at: Instant;
  readonly cancellation_ref: OpaqueRef;
  readonly issued_at: Instant;
  readonly channel_binding: ChannelBindingKindV1;
  readonly transport_scopes: readonly ('mcp:discover' | 'mcp:tools:invoke')[];
  readonly idempotency_key?: string;
  readonly elicitation_ref?: OpaqueRef;
  readonly delegation?: DelegationBindingV1;
  readonly neutral_credential: string;
  readonly neutral_context_ref?: OpaqueRef;
}
export interface MemoryContextProjectionV1 {
  readonly agent_id: OpaqueRef;
  readonly purpose_ref: OpaqueRef;
  readonly delegation?: DelegationBindingV1;
  readonly trusted_context: TrustedInvocationContextV1;
  readonly neutral_authorization: AuthorizationContextV1;
  readonly neutral_scope_ref: OpaqueRef;
  readonly neutral_principal: {
    readonly principal_namespace: OpaqueRef; readonly principal_id: OpaqueRef; readonly tenant_id: OpaqueRef;
  };
  readonly verified_claims: {
    readonly issuer: OpaqueRef; readonly sub: OpaqueRef; readonly tid: OpaqueRef;
    readonly claims_provenance_receipt: Digest; readonly tenant_membership_receipt: Digest;
  };
  readonly lifecycle_binding: { readonly deadline_at: Instant; readonly cancellation_ref: OpaqueRef };
  readonly channel_binding: ChannelBindingKindV1;
  readonly transport_scopes: readonly ('mcp:discover' | 'mcp:tools:invoke')[];
  readonly session_attachment: {
    readonly mcp_client_id: OpaqueRef; readonly logical_session_ref: OpaqueRef;
    readonly transport_attachment_ref: OpaqueRef; readonly connection_proof_digest: Digest;
  };
  readonly routing_provenance: {
    readonly publisher_id: 'sentropic.engram.memory'; readonly provider_id: 'sentropic.engram.memory';
    readonly connector_id: 'engram-memory'; readonly connector_instance_ref: OpaqueRef;
    readonly selected_source_id: 'mcp:engram-memory'; readonly active_generation: Cursor; readonly policy_epoch: Cursor;
  };
  readonly envelope_bindings: {
    readonly idempotency_key?: string; readonly elicitation_ref?: OpaqueRef;
    readonly audit_id: OpaqueRef; readonly correlation_ref: OpaqueRef;
  };
}
