/** Neutral DTO members co-frozen by Engram 60a8bfa8, consumed by M5. */
type Digest = `sha256:${string}`;
export interface CandidatePayloadV2 {
  schema_version: 2;
  scope_ref: string;
  purpose_ref: string;
  valid_time: { t: number; t_end?: number };
  components: ReadonlyArray<{ component_id: string; kind: 'context' | 'decision' | 'evidence'; text: string; citation_ids: ReadonlyArray<string> }>;
  primary_component_id: string;
  primary_event: { at: number; type_ref: string; citation_id: string };
  citations: ReadonlyArray<{ citation_id: string; source_ref: string; locator: { scheme: string; value: string }; content_digest: Digest; observed_at?: string }>;
  retention: { expires_at?: string; derivative_rule: 'retain' | 'make-ineligible' };
  reconciliation: { family_refs: ReadonlyArray<string> };
  derivation?: { source_record_ids: ReadonlyArray<string>; transform_ref: string; transform_receipt_digest: Digest };
}
export interface EvidenceBundleV1 {
  evidence_ref: string;
  evidence_digest: Digest;
  citation_ids: ReadonlyArray<string>;
  attestation?: string;
}
export interface LifecycleEventAnchorV1 {
  occurred_at: string;
  kind_ref: string;
  provenance_ref: string;
  provenance_digest: Digest;
}
