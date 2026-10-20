// G1c first-proof enforcement: K7 capture and K8 admission transitions
// preserve original results across completion, destruction and replay.

import { describe, expect, it } from 'vitest';
import {
  validateAdmissionTransition,
  validateCaptureTransition,
} from '../../src/engram-memory/validation.js';

const capture = (overrides: Record<string, unknown> = {}) => ({
  candidateId: 'candidate-1',
  revision: 1,
  recordDigest: null,
  createdCursor: '0',
  proof: { intent: 'capture' },
  ...overrides,
});

const outcome = (overrides: Record<string, unknown> = {}) => ({
  candidateId: 'candidate-1',
  outcome: 'accepted',
  proof: { decision: 'accept' },
  ...overrides,
});

describe('memory K7 capture first proof', () => {
  it('should create at revision 1 with an absent record digest', () => {
    expect(validateCaptureTransition(null, capture()).ok).toBe(true);
    expect(validateCaptureTransition(undefined, capture()).ok).toBe(true);
    expect(validateCaptureTransition(null, capture({ revision: 2 })).ok).toBe(false);
    expect(validateCaptureTransition(null, capture({ recordDigest: 'sha256:x' })).ok).toBe(false);
  });

  it('should permit exactly the absent-to-filled completion 1 to 2', () => {
    const completed = capture({ revision: 2, recordDigest: 'sha256:abc' });
    expect(validateCaptureTransition(capture(), completed).ok).toBe(true);
  });

  it('should preserve every original proof field across completion', () => {
    const base = capture();
    expect(validateCaptureTransition(base, { ...base, revision: 2, recordDigest: 'sha256:abc', createdCursor: '9' }).ok).toBe(
      false,
    );
    expect(
      validateCaptureTransition(base, { ...base, revision: 2, recordDigest: 'sha256:abc', proof: { intent: 'other' } }).ok,
    ).toBe(false);
    expect(
      validateCaptureTransition(base, { ...base, revision: 2, recordDigest: 'sha256:abc', candidateId: 'candidate-2' }).ok,
    ).toBe(false);
    expect(validateCaptureTransition(base, { ...base, revision: 3, recordDigest: 'sha256:abc' }).ok).toBe(false);
    expect(validateCaptureTransition(base, { ...base, revision: 2, recordDigest: '' }).ok).toBe(false);
  });

  it('should treat identical replay as a no-op and freeze completed proofs', () => {
    const completed = capture({ revision: 2, recordDigest: 'sha256:abc' });
    expect(validateCaptureTransition(completed, { ...completed }).ok).toBe(true);
    expect(validateCaptureTransition(completed, { ...completed, recordDigest: 'sha256:other' }).ok).toBe(false);
  });
});

describe('memory K8 admission first proof', () => {
  it('should fix the first admission outcome permanently', () => {
    expect(validateAdmissionTransition(null, outcome()).ok).toBe(true);
    expect(validateAdmissionTransition(outcome(), outcome()).ok).toBe(true);
    expect(validateAdmissionTransition(outcome(), outcome({ outcome: 'rejected' })).ok).toBe(false);
    expect(validateAdmissionTransition(outcome(), outcome({ proof: { decision: 'other' } })).ok).toBe(false);
    expect(validateAdmissionTransition(outcome(), outcome({ candidateId: 'candidate-2' })).ok).toBe(false);
  });
});
