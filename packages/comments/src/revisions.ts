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
import { hashRecord } from './revision-hash.js';

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

/** A target binding: complete resource identity plus its source-version indicator. */
export type RevisionTargetBinding = {
  readonly resource: ResourceRef;
  readonly source: SourceVersionIndicator;
};

/** Visual anchor binding: anchor, frame, quantized shape, order and style. */
export type VisualAnchorBinding = {
  readonly anchor: Anchor;
  readonly frame: { readonly width: number; readonly height: number; readonly digest: string };
  readonly shape: QuantizedGeometry;
  readonly shapeId: string;
  readonly style?: string;
};

/** Versioned body codec descriptor; the exact specification digest is pinned. */
export type BodyCodecDescriptor = {
  readonly format: 'plain' | 'commonmark';
  readonly codecId: string;
  readonly specDigest: string;
  readonly extensions: readonly string[];
};

/** Ordered, non-overlapping segment with exact code-point bounds. */
export type BodySegment = {
  readonly start: number;
  readonly end: number;
  readonly digest: string;
};

/** Active mention: opaque scoped principal with exact source/display text and spans. */
export type BodyMention = {
  readonly principal: string;
  readonly displayText: string;
  readonly start: number;
  readonly end: number;
};

/** Host semantic profile; unknown profiles fail closed at validation. */
export type SemanticProfile = {
  readonly schemaId: string;
  readonly version: string;
  readonly digest: string;
  readonly fields: Readonly<Record<string, string | number | boolean | null>>;
};

/** Canonical body content of one revision. */
export type RevisionBody = {
  readonly text: string;
  readonly codec: BodyCodecDescriptor;
  readonly segments?: readonly BodySegment[];
  readonly mentions?: readonly BodyMention[];
  readonly profile?: SemanticProfile;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const countCodePoints = (value: string): number => [...value].length;

const validateSpans = (
  spans: ReadonlyArray<{ start: number; end: number }>,
  label: 'segment' | 'mention',
  text: string,
): void => {
  let previousEnd = 0;
  for (const span of spans) {
    if (
      !Number.isSafeInteger(span.start) ||
      !Number.isSafeInteger(span.end) ||
      span.start < previousEnd ||
      span.end <= span.start ||
      span.end > countCodePoints(text)
    ) {
      throw new RevisionValidationError(
        'invalid-body',
        `${label} span ${span.start}:${span.end} is out of bounds or overlapping`,
      );
    }
    previousEnd = span.end;
  }
};

/** Validate body content: codec descriptor, segment/mention spans, profile shape. */
export const validateRevisionBody = (body: RevisionBody): RevisionBody => {
  if (
    !isNonEmptyString(body.text) ||
    (body.codec.format !== 'plain' && body.codec.format !== 'commonmark') ||
    !isNonEmptyString(body.codec.codecId) ||
    !isNonEmptyString(body.codec.specDigest) ||
    !Array.isArray(body.codec.extensions)
  ) {
    throw new RevisionValidationError('invalid-body', 'Invalid body codec descriptor');
  }
  if (body.segments !== undefined) {
    validateSpans(body.segments, 'segment', body.text);
    for (const segment of body.segments) {
      if (!isNonEmptyString(segment.digest)) {
        throw new RevisionValidationError('invalid-body', 'Segment digest missing');
      }
    }
  }
  if (body.mentions !== undefined) {
    validateSpans(body.mentions, 'mention', body.text);
    for (const mention of body.mentions) {
      if (!isNonEmptyString(mention.principal) || !isNonEmptyString(mention.displayText)) {
        throw new RevisionValidationError('invalid-mentions', 'Mention principal/display missing');
      }
      const mentioned = [...body.text].slice(mention.start, mention.end).join('');
      if (mentioned !== mention.displayText) {
        throw new RevisionValidationError('invalid-mentions', 'Mention span text does not match');
      }
    }
  }
  if (body.profile !== undefined) {
    const { schemaId, version, digest } = body.profile;
    if (!isNonEmptyString(schemaId) || !isNonEmptyString(version) || !isNonEmptyString(digest)) {
      throw new RevisionValidationError('invalid-body', 'Invalid semantic profile');
    }
    for (const value of Object.values(body.profile.fields)) {
      if (typeof value === 'number' && (!Number.isInteger(value) || !Number.isSafeInteger(value))) {
        throw new RevisionValidationError('invalid-body', 'Profile numbers must be safe integers');
      }
    }
  }
  return body;
};

/** Validate the ordered target bindings of a revision: complete identities, no ambiguous duplicates. */
export const validateRevisionTargets = (
  scope: { tenantId: string; workspaceId: string },
  primary: RevisionTargetBinding,
  secondary: readonly RevisionTargetBinding[],
): void => {
  if (!isNonEmptyString(scope.tenantId) || !isNonEmptyString(scope.workspaceId)) {
    throw new RevisionValidationError('invalid-scope', 'Revision scope is incomplete');
  }
  const seen = new Set<string>();
  for (const binding of [primary, ...secondary]) {
    if (scopeKey(binding.resource.scope) !== scopeKey(scope)) {
      throw new RevisionValidationError('invalid-targets', 'Target resource is out of scope');
    }
    const key = resourceKey(binding.resource);
    if (seen.has(key)) {
      throw new RevisionValidationError('duplicate-target', `Ambiguous duplicate target: ${key}`);
    }
    seen.add(key);
  }
};

/** Validate revision provenance; registration time is an integer epoch ms. */
export const validateRevisionProvenance = (provenance: RevisionProvenance): RevisionProvenance => {
  if (
    !isNonEmptyString(provenance.registration.principal) ||
    !Number.isSafeInteger(provenance.registration.registeredAt) ||
    provenance.registration.registeredAt < 0
  ) {
    throw new RevisionValidationError('invalid-provenance', 'Registration principal/instant invalid');
  }
  const attribution = provenance.attribution;
  if (attribution.variant === 'unknown') {
    if (!isNonEmptyString(attribution.classification)) {
      throw new RevisionValidationError('invalid-provenance', 'Unknown attribution needs a classification');
    }
  } else if (!isNonEmptyString(attribution.assertionClass) || !isNonEmptyString(attribution.evidence)) {
    throw new RevisionValidationError('invalid-provenance', 'Attribution needs assertion class and evidence');
  }
  if (provenance.sourceTime !== undefined) {
    const { lexical, dateKind, precision } = provenance.sourceTime;
    if (!isNonEmptyString(lexical) || !isNonEmptyString(dateKind) || !isNonEmptyString(precision)) {
      throw new RevisionValidationError('invalid-provenance', 'Source time needs lexical value, kind and precision');
    }
  }
  return provenance;
};

/** Immutable annotation revision (hashed record kind `annotation-revision`). */
export type AnnotationRevisionRecord = {
  readonly kind: 'annotation-revision';
  readonly scope: { readonly tenantId: string; readonly workspaceId: string };
  readonly annotationId: string;
  readonly link: { readonly sequence: number; readonly previousHash: string | null };
  readonly primary: RevisionTargetBinding;
  readonly secondary: readonly RevisionTargetBinding[];
  readonly visualAnchors: readonly VisualAnchorBinding[];
  readonly body: RevisionBody;
  readonly provenance: RevisionProvenance;
  /** Computed canonical digest of this record. */
  readonly hash: string;
};

/** Immutable thread structural revision (kind `thread-structure-revision`). */
export type ThreadStructureRevisionRecord = {
  readonly kind: 'thread-structure-revision';
  readonly scope: { readonly tenantId: string; readonly workspaceId: string };
  readonly threadId: string;
  readonly link: { readonly sequence: number; readonly previousHash: string | null };
  readonly trigger: StructuralTrigger;
  readonly primary: RevisionTargetBinding;
  readonly annotationId: string | null;
  readonly provenance: RevisionProvenance;
  readonly hash: string;
};

/** Immutable comment revision (kind `comment-revision`). */
export type CommentRevisionRecord = {
  readonly kind: 'comment-revision';
  readonly scope: { readonly tenantId: string; readonly workspaceId: string };
  readonly threadId: string;
  readonly commentId: string;
  readonly link: { readonly sequence: number; readonly previousHash: string | null };
  readonly parentCommentId: string | null;
  readonly structureRevision: { readonly id: string; readonly hash: string };
  readonly annotationPin: { readonly annotationId: string; readonly revisionHash: string } | null;
  readonly body: RevisionBody;
  readonly provenance: RevisionProvenance;
  readonly hash: string;
};

/**
 * Create an annotation revision. The primary resource identity is immutable
 * across revisions; a change creates a new annotation through a versioned
 * conversion, never an in-place edit. Content, anchors, geometry or semantic
 * metadata changes always create a new revision.
 */
export const createAnnotationRevision = (
  previous: AnnotationRevisionRecord | null,
  input: Omit<AnnotationRevisionRecord, 'kind' | 'link' | 'hash'>,
): AnnotationRevisionRecord => {
  validateRevisionTargets(input.scope, input.primary, input.secondary);
  validateRevisionBody(input.body);
  validateRevisionProvenance(input.provenance);
  if (previous !== null) {
    if (resourceKey(previous.primary.resource) !== resourceKey(input.primary.resource)) {
      throw new RevisionValidationError('invalid-targets', 'Annotation primary resource identity is immutable');
    }
  }
  const link = { sequence: previous === null ? 1 : previous.link.sequence + 1, previousHash: previous === null ? null : previous.hash };
  const envelope = { ...input, link };
  const hash = hashRecord('annotation-revision', envelope as unknown as Record<string, unknown>);
  return { ...envelope, kind: 'annotation-revision', hash };
};

/**
 * Create a thread structural revision. The trigger list is closed; assignment,
 * resolution, archive, new replies and a changed live resource alone never
 * create structural revisions. An annotation-bound structure retains the
 * annotation's immutable primary resource identity.
 */
export const createThreadStructureRevision = (
  previous: ThreadStructureRevisionRecord | null,
  input: Omit<ThreadStructureRevisionRecord, 'kind' | 'link' | 'hash'>,
): ThreadStructureRevisionRecord => {
  if (!isStructuralTrigger(input.trigger)) {
    throw new RevisionValidationError('invalid-trigger', `Unknown structural trigger: ${String(input.trigger)}`);
  }
  validateRevisionTargets(input.scope, input.primary, []);
  validateRevisionProvenance(input.provenance);
  if (previous !== null && previous.annotationId !== input.annotationId) {
    throw new RevisionValidationError('invalid-pin', 'Thread annotation identity is immutable');
  }
  const link = { sequence: previous === null ? 1 : previous.link.sequence + 1, previousHash: previous === null ? null : previous.hash };
  const envelope = { ...input, link };
  const hash = hashRecord('thread-structure-revision', envelope as unknown as Record<string, unknown>);
  return { ...envelope, kind: 'thread-structure-revision', hash };
};

/**
 * Create a comment revision. In an annotation-bound thread, the comment pins
 * exactly one revision/hash of that annotation; replies may deliberately pin
 * different revisions of the same annotation and old pins stay unchanged.
 * The parent relation is immutable for the lifetime of the comment.
 */
export const createCommentRevision = (
  previous: CommentRevisionRecord | null,
  input: Omit<CommentRevisionRecord, 'kind' | 'link' | 'hash'>,
): CommentRevisionRecord => {
  validateRevisionBody(input.body);
  validateRevisionProvenance(input.provenance);
  if (input.annotationPin !== null && (input.annotationPin.annotationId.length === 0 || input.annotationPin.revisionHash.length === 0)) {
    throw new RevisionValidationError('invalid-pin', 'Annotation pin needs an annotation id and exact revision hash');
  }
  if (previous !== null && previous.parentCommentId !== input.parentCommentId) {
    throw new RevisionValidationError('invalid-pin', 'Comment parent relation is immutable');
  }
  const link = { sequence: previous === null ? 1 : previous.link.sequence + 1, previousHash: previous === null ? null : previous.hash };
  const envelope = { ...input, link };
  const hash = hashRecord('comment-revision', envelope as unknown as Record<string, unknown>);
  return { ...envelope, kind: 'comment-revision', hash };
};
