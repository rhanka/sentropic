/**
 * Canonical revision hashing (SPEC §4.4).
 *
 * Every hashed record carries its closed `record-kind` discriminator and the
 * schema/hash version, is serialized with RFC 8785 canonical JSON over exact
 * UTF-8 bytes and digested with SHA-256. Revision chains are keyed by full
 * scope plus their stable annotation/thread/comment ID with a monotonic
 * sequence and a previous typed hash. Mutable projections are never hashed.
 */

import { canonicalJson } from './canonical-json.js';
import { sha256Hex } from './sha256.js';

/** Versioned hash scheme identifier for every canonical record digest. */
export const REVISION_HASH_VERSION = 'revision-hash-v1';

/** Closed `record-kind` set for `revision-hash-v1`. */
export const RECORD_KINDS = [
  'annotation-revision',
  'thread-structure-revision',
  'comment-revision',
  'review-event',
  'prepared-submission-manifest',
  'import-manifest',
  'unit-receipt',
  'batch-receipt-snapshot',
  'lifecycle-event',
  'operation-audit-event',
  'conversion-report',
] as const;

export type RecordKind = (typeof RECORD_KINDS)[number];

export const isRecordKind = (value: unknown): value is RecordKind =>
  typeof value === 'string' && (RECORD_KINDS as readonly string[]).includes(value);

/** A position in a typed hash chain; genesis has sequence 1 and previousHash null. */
export type ChainLink = {
  /** Monotonic sequence starting at 1. */
  readonly sequence: number;
  /** Previous typed hash; null only on the genesis record. */
  readonly previousHash: string | null;
};

/** Canonical hash envelope input: kind, chain link and kind-specific fields. */
export type HashEnvelope = Record<string, unknown>;

/** Hash validation error with a closed reason code. */
export class RevisionHashError extends Error {
  constructor(
    public readonly code:
      | 'invalid-kind'
      | 'invalid-chain'
      | 'invalid-envelope'
      | 'hash-mismatch'
      | 'chain-cycle'
      | 'chain-broken',
    message: string,
  ) {
    super(message);
    this.name = 'RevisionHashError';
  }
}

/**
 * Compute the canonical digest of one hashed record: SHA-256 over the RFC 8785
 * canonical UTF-8 bytes of `{ kind, hashVersion, ...envelope }`. The envelope
 * must not itself contain a `kind` or `hashVersion` field.
 */
export const hashRecord = (kind: RecordKind, envelope: HashEnvelope): string => {
  if (!isRecordKind(kind)) {
    throw new RevisionHashError('invalid-kind', `Unknown record kind: ${JSON.stringify(kind)}`);
  }
  if ('kind' in envelope || 'hashVersion' in envelope) {
    throw new RevisionHashError(
      'invalid-envelope',
      'Envelope must not override kind or hashVersion',
    );
  }
  let canonical: string;
  try {
    canonical = canonicalJson({ kind, hashVersion: REVISION_HASH_VERSION, ...envelope });
  } catch (error) {
    throw new RevisionHashError(
      'invalid-envelope',
      error instanceof Error ? error.message : 'Envelope is not canonically serializable',
    );
  }
  return sha256Hex(canonical);
};

/** Canonical UTF-8 JSON bytes of a record envelope, exposed for vector proofs. */
export const canonicalRecordBytes = (kind: RecordKind, envelope: HashEnvelope): string => {
  if (!isRecordKind(kind)) {
    throw new RevisionHashError('invalid-kind', `Unknown record kind: ${JSON.stringify(kind)}`);
  }
  if ('kind' in envelope || 'hashVersion' in envelope) {
    throw new RevisionHashError('invalid-envelope', 'Envelope must not override kind or hashVersion');
  }
  try {
    return canonicalJson({ kind, hashVersion: REVISION_HASH_VERSION, ...envelope });
  } catch (error) {
    throw new RevisionHashError(
      'invalid-envelope',
      error instanceof Error ? error.message : 'Envelope is not canonically serializable',
    );
  }
};

/** Validate the shape of one chain link. */
export const isChainLink = (value: unknown): value is ChainLink => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const link = value as { sequence?: unknown; previousHash?: unknown };
  return (
    Number.isSafeInteger(link.sequence) &&
    (link as { sequence: number }).sequence >= 1 &&
    (link.previousHash === null ||
      (typeof link.previousHash === 'string' && link.previousHash.length > 0))
  );
};

/**
 * Validate an ordered chain of typed hashes: sequence strictly increases from
 * 1, genesis carries previousHash null, every later record links the exact
 * predecessor digest, no digest repeats (cycle rejection), and every record
 * matches its expected kind (schema mismatch rejection).
 */
export const validateChain = (
  chain: ReadonlyArray<{
    readonly kind: RecordKind;
    readonly link: ChainLink;
    readonly hash: string;
  }>,
  options: { readonly expectedKind?: RecordKind } = {},
): void => {
  const seen = new Set<string>();
  let previous: string | null = null;
  let expectedSequence = 1;
  for (const record of chain) {
    if (options.expectedKind !== undefined && record.kind !== options.expectedKind) {
      throw new RevisionHashError(
        'chain-broken',
        `Record kind ${record.kind} does not match expected kind ${options.expectedKind}`,
      );
    }
    if (!isChainLink(record.link)) {
      throw new RevisionHashError('invalid-chain', 'Invalid chain link');
    }
    if (record.link.sequence !== expectedSequence) {
      throw new RevisionHashError(
        'chain-broken',
        `Sequence ${record.link.sequence} does not match expected ${expectedSequence}`,
      );
    }
    if (record.link.previousHash !== previous) {
      throw new RevisionHashError(
        'chain-broken',
        `previousHash does not match the chain predecessor at sequence ${record.link.sequence}`,
      );
    }
    if (seen.has(record.hash)) {
      throw new RevisionHashError('chain-cycle', `Digest repeats at sequence ${record.link.sequence}`);
    }
    seen.add(record.hash);
    previous = record.hash;
    expectedSequence += 1;
  }
};
