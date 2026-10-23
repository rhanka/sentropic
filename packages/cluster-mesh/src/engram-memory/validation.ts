// engram-memory first-proof enforcement (G4 lot, module-specific): K7
// capture completion, K8 admission permanence. Data-pure validators running
// at the trusted installed boundary, inside the backend transaction and
// before projection/effects. Global equal-digest replacement semantics for
// other modules are unchanged.

import { canonicalizeMemoryJcs } from './codec.js';
import { errResult, okResult, type ValidationResult } from '../storage/contracts.js';

export interface MemoryCaptureProof {
  readonly candidateId: string;
  readonly revision: number;
  readonly recordDigest: string | null;
  readonly createdCursor: string;
  readonly proof: unknown;
}

const sameValue = (left: unknown, right: unknown): boolean => {
  try {
    return canonicalizeMemoryJcs(left) === canonicalizeMemoryJcs(right);
  } catch {
    return false;
  }
};

export const isMemoryCaptureProof = (value: unknown): value is MemoryCaptureProof => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['candidateId'] === 'string' &&
    Number.isSafeInteger(candidate['revision']) &&
    (typeof candidate['recordDigest'] === 'string' || candidate['recordDigest'] === null) &&
    typeof candidate['createdCursor'] === 'string' &&
    'proof' in candidate
  );
};

/**
 * K7 creation fixes content digest, created cursor and original capture
 * proof. Permits exactly the specified absent-to-filled `record_digest`
 * completion (revision 1→2, proof preserved, no journal event). Later
 * identical replay returns the original; conflicting completion fails
 * without writes.
 */
export const validateCaptureTransition = (current: unknown, proposed: unknown): ValidationResult => {
  if (!isMemoryCaptureProof(proposed)) return errResult('capture proposal must carry candidateId, revision, recordDigest, createdCursor and proof');
  if (current === null || current === undefined) {
    if (proposed.revision !== 1) return errResult('capture creation must start at revision 1');
    if (proposed.recordDigest !== null) return errResult('capture creation must leave recordDigest absent');
    return okResult();
  }
  if (!isMemoryCaptureProof(current)) return errResult('stored capture proof is not a capture record');
  if (current.candidateId !== proposed.candidateId) return errResult('capture candidateId is immutable');
  if (sameValue(current, proposed)) return okResult();
  if (current.revision !== 1 || current.recordDigest !== null) {
    return errResult('completed capture proof is immutable');
  }
  if (proposed.revision !== 2) return errResult('capture completion must advance revision 1 to 2');
  if (typeof proposed.recordDigest !== 'string' || proposed.recordDigest.length === 0) {
    return errResult('capture completion must fill recordDigest');
  }
  if (proposed.createdCursor !== current.createdCursor) return errResult('capture createdCursor is immutable');
  if (!sameValue(current.proof, proposed.proof)) return errResult('capture proof fields are immutable');
  const { revision: _r1, recordDigest: _d1, ...currentRest } = current;
  const { revision: _r2, recordDigest: _d2, ...proposedRest } = proposed;
  if (!sameValue(currentRest, proposedRest)) return errResult('capture completion must not change any other field');
  return okResult();
};

export interface MemoryAdmissionOutcome {
  readonly candidateId: string;
  readonly outcome: unknown;
  readonly proof: unknown;
}

export const isMemoryAdmissionOutcome = (value: unknown): value is MemoryAdmissionOutcome => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['candidateId'] === 'string' && 'outcome' in candidate && 'proof' in candidate;
};

/**
 * K8 fixes the first admission outcome permanently. No replacement or
 * deletion after envelope destruction, rejection or later lifecycle
 * changes. Identical replay is a no-op; mismatched proof or identity is
 * refused before effects.
 */
export const validateAdmissionTransition = (current: unknown, proposed: unknown): ValidationResult => {
  if (!isMemoryAdmissionOutcome(proposed)) return errResult('admission proposal must carry candidateId, outcome and proof');
  if (current === null || current === undefined) return okResult();
  if (!isMemoryAdmissionOutcome(current)) return errResult('stored admission outcome is not an admission record');
  if (current.candidateId !== proposed.candidateId) return errResult('admission candidateId is immutable');
  if (sameValue(current, proposed)) return okResult();
  return errResult('admission outcome is first-proof immutable');
};
