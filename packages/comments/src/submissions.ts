/**
 * Canonical prepared-submission contracts (SPEC §4.4, unitary preparation).
 *
 * A prepared submission manifest freezes one exact annotation revision/hash
 * together with the ordered selection of comment and structural revisions that
 * will be submitted, the capture digests and the contract/profile versions in
 * force. It is a standalone genesis record — no predecessor link — and its
 * receipt is recoverable: the digest recomputes from the manifest alone, so a
 * host can verify a returned receipt without trusting any stored flag.
 */

import { canonicalRecordBytes, hashRecord } from './revision-hash.js';
import { sha256Hex } from './sha256.js';
import { validateCapacityDescriptor } from './revisions.js';
import { RevisionValidationError } from './revisions.js';
import type { CapacityDescriptor } from './revisions.js';
import type { CanonicalStoreScope } from './command-store.js';

/** Submission validation error with a closed reason code. */
export class SubmissionValidationError extends Error {
  constructor(
    public readonly code: 'invalid-manifest' | 'invalid-selection' | 'hash-mismatch',
    message: string,
  ) {
    super(message);
    this.name = 'SubmissionValidationError';
  }
}

/** One exactly pinned selected comment revision, in submission order. */
export type SelectedCommentRevision = {
  readonly commentId: string;
  readonly revisionHash: string;
};

/** One exactly pinned selected thread structural revision, in submission order. */
export type SelectedStructureRevision = {
  readonly threadId: string;
  readonly revisionHash: string;
};

/** Immutable prepared submission manifest (kind `prepared-submission-manifest`). */
export type PreparedSubmissionManifest = {
  readonly kind: 'prepared-submission-manifest';
  readonly scope: CanonicalStoreScope;
  readonly submissionId: string;
  /** Exact annotation revision submitted; no latest substitution, ever. */
  readonly annotation: { readonly annotationId: string; readonly revisionHash: string };
  /** Ordered, duplicate-free selection of comment revisions. */
  readonly selectedComments: readonly SelectedCommentRevision[];
  /** Ordered, duplicate-free selection of structural revisions. */
  readonly selectedStructures: readonly SelectedStructureRevision[];
  /** Ordered capture digests bound into the submission. */
  readonly captureDigests: readonly string[];
  /** Contract vocabulary version in force at preparation. */
  readonly contractVersion: string;
  /** Host semantic profile version in force at preparation. */
  readonly profileVersion: string;
  readonly preparedBy: { readonly principal: string };
  readonly hash: string;
};

/** Recoverable receipt of one prepared submission. */
export type PreparedSubmissionReceipt = {
  readonly manifestHash: string;
  readonly manifestDigest: string;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const hasNoDuplicate = (ids: readonly string[]): boolean => new Set(ids).size === ids.length;

const validateSelection = (manifest: Omit<PreparedSubmissionManifest, 'kind' | 'hash'>): void => {
  if (manifest.selectedComments.some((item) => !isNonEmptyString(item.commentId) || !isNonEmptyString(item.revisionHash))) {
    throw new SubmissionValidationError('invalid-selection', 'Selected comments need ids and exact revision hashes');
  }
  if (manifest.selectedStructures.some((item) => !isNonEmptyString(item.threadId) || !isNonEmptyString(item.revisionHash))) {
    throw new SubmissionValidationError('invalid-selection', 'Selected structures need ids and exact revision hashes');
  }
  if (!hasNoDuplicate(manifest.selectedComments.map((item) => item.commentId))) {
    throw new SubmissionValidationError('invalid-selection', 'Selected comments contain a duplicate id');
  }
  if (!hasNoDuplicate(manifest.selectedStructures.map((item) => item.threadId))) {
    throw new SubmissionValidationError('invalid-selection', 'Selected structures contain a duplicate id');
  }
  if (manifest.captureDigests.some((digest) => !isNonEmptyString(digest))) {
    throw new SubmissionValidationError('invalid-selection', 'Capture digests are non-empty strings');
  }
};

/**
 * Create a prepared submission manifest. Standalone genesis: the record hashes
 * only its own content, never a predecessor, and the selection order is the
 * submission order. The required capacity descriptor is validated in full
 * (fail closed when missing or invalid) and its `unitManifest` bound is
 * enforced over the manifest's canonical bytes before the record is built;
 * the descriptor's values never enter the manifest hash.
 */
export const createPreparedSubmissionManifest = (
  input: Omit<PreparedSubmissionManifest, 'kind' | 'hash'>,
  capacity: CapacityDescriptor,
): PreparedSubmissionManifest => {
  validateCapacityDescriptor(capacity);
  if (
    !isNonEmptyString(input.submissionId) ||
    !isNonEmptyString(input.annotation.annotationId) ||
    !isNonEmptyString(input.annotation.revisionHash) ||
    !isNonEmptyString(input.contractVersion) ||
    !isNonEmptyString(input.profileVersion) ||
    !isNonEmptyString(input.preparedBy.principal)
  ) {
    throw new SubmissionValidationError('invalid-manifest', 'Manifest needs ids, exact revision pin, versions and principal');
  }
  validateSelection(input);
  const manifestBytes = new TextEncoder().encode(
    canonicalRecordBytes('prepared-submission-manifest', input as unknown as Record<string, unknown>),
  ).length;
  if (manifestBytes > capacity.unitManifest.limit) {
    throw new RevisionValidationError(
      'capacity-exceeded',
      `Manifest is ${manifestBytes} canonical bytes, bound is ${capacity.unitManifest.limit}`,
    );
  }
  const hash = hashRecord('prepared-submission-manifest', input as unknown as Record<string, unknown>);
  return { ...input, kind: 'prepared-submission-manifest', hash };
};

/**
 * Recover the receipt of a prepared submission: the manifest hash plus the
 * digest over its exact canonical bytes. Both recompute from the manifest
 * alone, so recovery never depends on stored mutable state.
 */
export const recoverPreparedSubmissionReceipt = (
  manifest: PreparedSubmissionManifest,
): PreparedSubmissionReceipt => {
  const { kind: _kind, hash: _hash, ...envelope } = manifest;
  return {
    manifestHash: manifest.hash,
    manifestDigest: sha256Hex(canonicalRecordBytes('prepared-submission-manifest', envelope)),
  };
};

/**
 * Verify a manifest against its own hash: recompute the canonical digest and
 * compare. A mismatch (or a forged field) fails closed.
 */
export const verifyPreparedSubmission = (manifest: PreparedSubmissionManifest): boolean => {
  const { kind: _kind, hash: _hash, ...envelope } = manifest;
  return hashRecord('prepared-submission-manifest', envelope) === manifest.hash;
};
