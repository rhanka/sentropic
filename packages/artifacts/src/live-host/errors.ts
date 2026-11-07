/** Closed refusal codes of the live host code. A refusal never carries caller text. */
export type LiveHostErrorCode = 'candidate_invalid' | 'candidate_bytes_mismatch' | 'handoff_unauthenticated'
  | 'handoff_expired' | 'handoff_mismatch' | 'handoff_replayed' | 'handoff_evidence_missing' | 'receipt_invalid';
export class LiveHostError extends Error {
  /** `reason` names the failed host recheck item on `handoff_mismatch`. */
  constructor(readonly code: LiveHostErrorCode, readonly reason?: string) { super(code); this.name = 'LiveHostError'; }
}
