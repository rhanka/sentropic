/**
 * Canonical identity and anchor contracts (SPEC §4.1-4.2).
 *
 * Every identity and reference carries an authoritative opaque
 * `(tenantId, workspaceId)` scope. Comments never infers shadow/alias mode or
 * synthetic/real membership from ID strings and never rejects equality between
 * tenant and workspace as a proxy for scope validity.
 */

/** Opaque authoritative scope; both IDs are host-supplied opaque strings. */
export type CanonicalScope = {
  readonly tenantId: string;
  readonly workspaceId: string;
};

/** Complete opaque resource identity: scope plus namespace, kind, stable ID. */
export type ResourceRef = {
  readonly scope: CanonicalScope;
  readonly namespace: string;
  readonly kind: string;
  readonly id: string;
};

/**
 * Hashed source-version indicator carried by every target, anchor and
 * discussion structural binding (SPEC §4.2). Exactly one variant applies.
 */
export type SourceVersionIndicator =
  | {
      readonly variant: 'observed';
      /** Immutable source version or authorized snapshot digest. */
      readonly sourceVersion: string;
      /** Evidence that this was the author's observed source. */
      readonly evidence: string;
    }
  | {
      readonly variant: 'fixed-at-conversion';
      /** Version/digest captured by conversion. */
      readonly sourceVersion: string;
      /** Reference to the conversion operation that captured it. */
      readonly conversionRef: string;
      /** Always explicit: the binding never asserts what the author saw. */
      readonly historicalGap: true;
    }
  | {
      readonly variant: 'unknown';
      /** Explicit evidence/gap classification; no fabricated digest. */
      readonly classification: string;
    };

/** Stable field selector for field anchors; position pointers are exact-version only. */
export type FieldSelector =
  | { readonly format: 'stable-id'; readonly value: string }
  | { readonly format: 'json-pointer'; readonly value: string };

/** Anchor kinds supported for arbitrary host resource kinds. */
export type AnchorKind = 'data' | 'field' | 'text' | 'ui' | 'capture';

/** Data/record anchor: resource reference plus explicit source-version indicator. */
export type DataAnchor = {
  readonly kind: 'data';
  readonly resource: ResourceRef;
  readonly source: SourceVersionIndicator;
};

/** Field anchor: data anchor plus a versioned field selector. */
export type FieldAnchor = {
  readonly kind: 'field';
  readonly resource: ResourceRef;
  readonly source: SourceVersionIndicator;
  readonly field: FieldSelector;
};

/** Text anchor: exact quote with context and authoritative code-point offsets. */
export type TextAnchor = {
  readonly kind: 'text';
  readonly resource: ResourceRef;
  readonly source: SourceVersionIndicator;
  readonly quote: string;
  readonly prefixContext: string;
  readonly suffixContext: string;
  /** Unicode code points, end exclusive, against the recorded source version. */
  readonly startOffset: number;
  readonly endOffset: number;
};

/** UI anchor: stable host surface/element key; selectors/coordinates are hints only. */
export type UiAnchor = {
  readonly kind: 'ui';
  readonly resource: ResourceRef;
  readonly source: SourceVersionIndicator;
  readonly surfaceKey: string;
  readonly renderVersion: string;
  readonly captureRef?: string;
};

/** Immutable capture reference; missing/unauthorized/purged bytes make it unavailable. */
export type CaptureAnchor = {
  readonly kind: 'capture';
  readonly blobId: string;
  readonly digest: string;
  readonly mimeType: string;
  readonly intrinsicWidth: number;
  readonly intrinsicHeight: number;
  /** Integer UTC epoch milliseconds. */
  readonly capturedAt: number;
  readonly source: SourceVersionIndicator;
};

export type Anchor = DataAnchor | FieldAnchor | TextAnchor | UiAnchor | CaptureAnchor;

/** Explicit host resolver outcomes; never a silent reattachment. */
export type ResolverOutcome =
  | 'exact'
  | 'source-changed'
  | 'unresolved'
  | 'unavailable';

/** Anchor validation error with a closed reason code. */
export class AnchorValidationError extends Error {
  constructor(
    public readonly code:
      | 'invalid-scope'
      | 'invalid-resource'
      | 'invalid-indicator'
      | 'invalid-field'
      | 'invalid-text-offsets'
      | 'invalid-capture'
      | 'unknown-kind',
    message: string,
  ) {
    super(message);
    this.name = 'AnchorValidationError';
  }
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

/** Structural scope guard; equality of tenant/workspace is never rejected. */
export const isCanonicalScope = (value: unknown): value is CanonicalScope =>
  typeof value === 'object' &&
  value !== null &&
  isNonEmptyString((value as { tenantId?: unknown }).tenantId) &&
  isNonEmptyString((value as { workspaceId?: unknown }).workspaceId);

/** Structural resource reference guard. */
export const isResourceRef = (value: unknown): value is ResourceRef =>
  typeof value === 'object' &&
  value !== null &&
  isCanonicalScope((value as { scope?: unknown }).scope) &&
  isNonEmptyString((value as { namespace?: unknown }).namespace) &&
  isNonEmptyString((value as { kind?: unknown }).kind) &&
  isNonEmptyString((value as { id?: unknown }).id);

/** Structural source-version indicator guard; the closed variant set is enforced. */
export const isSourceVersionIndicator = (value: unknown): value is SourceVersionIndicator => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  switch (candidate.variant) {
    case 'observed':
      return isNonEmptyString(candidate.sourceVersion) && isNonEmptyString(candidate.evidence);
    case 'fixed-at-conversion':
      return (
        isNonEmptyString(candidate.sourceVersion) &&
        isNonEmptyString(candidate.conversionRef) &&
        candidate.historicalGap === true
      );
    case 'unknown':
      return isNonEmptyString(candidate.classification);
    default:
      return false;
  }
};

/** Canonical scope key used by chain and hash envelopes. */
export const scopeKey = (scope: CanonicalScope): string =>
  `${scope.tenantId}\u{0}w${scope.workspaceId}`;

/** Canonical resource key; queries always use the complete identity. */
export const resourceKey = (resource: ResourceRef): string =>
  `${resource.namespace}\u{0}${resource.kind}\u{0}${resource.id}`;

/** Validate one anchor against the closed variant rules. */
export const validateAnchor = (anchor: Anchor): Anchor => {
  if (anchor.kind === 'capture') {
    if (
      !isNonEmptyString(anchor.blobId) ||
      !isNonEmptyString(anchor.digest) ||
      !isNonEmptyString(anchor.mimeType) ||
      !isSafeInteger(anchor.intrinsicWidth) ||
      anchor.intrinsicWidth <= 0 ||
      !isSafeInteger(anchor.intrinsicHeight) ||
      anchor.intrinsicHeight <= 0 ||
      !isSafeInteger(anchor.capturedAt) ||
      anchor.capturedAt < 0 ||
      !isSourceVersionIndicator(anchor.source)
    ) {
      throw new AnchorValidationError('invalid-capture', 'Invalid capture anchor');
    }
    return anchor;
  }
  if (!isResourceRef(anchor.resource)) {
    throw new AnchorValidationError('invalid-resource', 'Invalid resource reference');
  }
  if (!isSourceVersionIndicator(anchor.source)) {
    throw new AnchorValidationError('invalid-indicator', 'Invalid source-version indicator');
  }
  if (anchor.kind === 'field') {
    if (
      (anchor.field.format !== 'stable-id' && anchor.field.format !== 'json-pointer') ||
      !isNonEmptyString(anchor.field.value)
    ) {
      throw new AnchorValidationError('invalid-field', 'Invalid field selector');
    }
    return anchor;
  }
  if (anchor.kind === 'text') {
    if (
      !isSafeInteger(anchor.startOffset) ||
      anchor.startOffset < 0 ||
      !isSafeInteger(anchor.endOffset) ||
      anchor.endOffset < anchor.startOffset
    ) {
      throw new AnchorValidationError('invalid-text-offsets', 'Invalid text anchor offsets');
    }
    return anchor;
  }
  if (anchor.kind === 'ui') {
    if (!isNonEmptyString(anchor.surfaceKey) || !isNonEmptyString(anchor.renderVersion)) {
      throw new AnchorValidationError('invalid-indicator', 'Invalid UI anchor');
    }
    return anchor;
  }
  if (anchor.kind !== 'data') {
    throw new AnchorValidationError('unknown-kind', `Unknown anchor kind: ${String(anchor.kind)}`);
  }
  return anchor;
};
