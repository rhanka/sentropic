/**
 * Canonical revision records (SPEC §4.1, §4.5, §4.6).
 *
 * Immutable annotation, thread-structure and comment revisions carry the
 * content, provenance and anchor material of the canonical model. The
 * annotation's primary resource identity is immutable across revisions;
 * mutable aggregates and projections are never hashed.
 */

import type { Anchor, ResourceRef, SourceVersionIndicator } from './anchors.js';
import { resourceKey, scopeKey } from './anchors.js';
import type { QuantizedGeometry } from './geometry.js';

/** Structural revision triggers: the closed list (SPEC §4.1). */
export const STRUCTURAL_TRIGGERS = [
  'initial-registration',
  'resource-rebinding',
  'reanchoring',
  'structural-association-change',
] as const;

export type StructuralTrigger = (typeof STRUCTURAL_TRIGGERS)[number];

export const isStructuralTrigger = (value: unknown): value is StructuralTrigger =>
  typeof value === 'string' && (STRUCTURAL_TRIGGERS as readonly string[]).includes(value);

/** Technical registration: fixed at commit, recovered unchanged on retry. */
export type RevisionRegistration = {
  readonly principal: string;
  /** Integer UTC epoch milliseconds. */
  readonly registeredAt: number;
};

/** Documentary attribution: explicit human, AI or unknown (SPEC §4.5). */
export type DocumentaryAttribution =
  | {
      readonly variant: 'human' | 'ai';
      readonly sourceLocalId?: string;
      readonly assertionClass: string;
      readonly evidence: string;
    }
  | {
      readonly variant: 'unknown';
      readonly classification: string;
    };

/**
 * Source time: original lexical value with its kind and precision. A `zone`
 * field is present only when evidenced; its absence means the zone is
 * explicitly unknown, which differs from the whole `sourceTime` being absent.
 */
export type SourceTime = {
  readonly lexical: string;
  readonly dateKind: string;
  readonly precision: string;
  readonly zone?: string;
  /** Parsed instant (integer UTC epoch ms) only when supported. */
  readonly parsedAt?: number;
};

/** Import/execution binding: importer never replaces the source author. */
export type ImportExecution = {
  readonly sourceNamespace: string;
  readonly sourceRecordId: string;
  readonly sourceVersion: string;
  readonly sourceDigest: string;
  readonly parserVersion: string;
  readonly mappingVersion: string;
  readonly conversionVersion: string;
  readonly executorService: string;
  readonly executorRun: string;
};

/** Provenance bound to every annotation, structural and comment revision. */
export type RevisionProvenance = {
  readonly registration: RevisionRegistration;
  readonly attribution: DocumentaryAttribution;
  readonly sourceTime?: SourceTime;
  readonly importExecution?: ImportExecution;
};

/** Revision validation error with a closed reason code. */
export class RevisionValidationError extends Error {
  constructor(
    public readonly code:
      | 'invalid-scope'
      | 'invalid-targets'
      | 'duplicate-target'
      | 'invalid-trigger'
      | 'invalid-body'
      | 'invalid-mentions'
      | 'invalid-provenance'
      | 'invalid-pin',
    message: string,
  ) {
    super(message);
    this.name = 'RevisionValidationError';
  }
}

