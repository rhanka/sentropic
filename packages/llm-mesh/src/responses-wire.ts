/**
 * Typed allowlisted native Responses carrier (spec §16.3). Holds validated
 * Responses input/output semantics that have no canonical message
 * equivalent, in `providerOptions` / event metadata / `providerMetadata`,
 * for native input order, item identity, completed reasoning artifacts and
 * terminal output snapshots.
 *
 * Constructed from validated fields only — never copies caller routing or
 * auth controls. Only the matching native adapter consumes it; public
 * responses filter it again (credentials, raw provider errors and internal
 * headers never enter it). No Hono or caller-auth dependency.
 */

/** Validated custom/freeform tool, carried opaquely for native execution. */
export interface ResponsesCustomTool {
  readonly type: 'custom';
  /** Bare tool name as declared (namespace carried separately). */
  readonly name: string;
  readonly description?: string;
  /** Codex freeform format (string marker or grammar object, carried opaquely). */
  readonly format?: string | Record<string, unknown>;
  /** Declaring namespace, when nested (Codex `additional_tools`). */
  readonly namespace?: string;
  readonly providerMetadata?: Record<string, unknown>;
}

/** Function tool identity preserved through namespace flattening. */
export interface ResponsesFunctionToolRef {
  readonly qualifiedName: string;
  readonly bareName: string;
  readonly namespace?: string;
}

/** Completed reasoning history item, preserved for native replay. */
export interface ResponsesReasoningArtifact {
  readonly itemId?: string;
  readonly summary?: string;
  /** Opaque encrypted content — never fabricated, never exposed as text. */
  readonly encryptedContent?: string;
}

/**
 * Allowlisted native request carrier. Custom tools, reasoning context and
 * verbosity are consumable only by a native Responses adapter (Codex);
 * translated adapters refuse the round trip when these are present via
 * execution-feature eligibility.
 */
export interface ResponsesNativeRequestCarrier {
  readonly customTools: readonly ResponsesCustomTool[];
  readonly functionToolRefs: readonly ResponsesFunctionToolRef[];
  readonly reasoningArtifacts: readonly ResponsesReasoningArtifact[];
  /** Codex server-side retention hint; native-only, never routed upon. */
  readonly reasoningContext?: string;
  /** Requested verbosity level; native-only unless an equivalent is proven. */
  readonly verbosity?: string;
  /** Opaque client cache hint; forwarded only to declaring adapters. */
  readonly promptCacheKey?: string;
  readonly safetyIdentifier?: string;
  /** Validated harmless telemetry (object of scalars, bounded). */
  readonly clientMetadata?: Record<string, unknown>;
  /** Validated request metadata echo (bounded, never routing). */
  readonly requestMetadata?: Record<string, unknown>;
  /** Native input item ids in order (identity/order preservation). */
  readonly itemIds: readonly string[];
}

export const RESPONSES_CARRIER_OPTION_KEY = 'responses' as const;

/**
 * Read the validated Responses carrier off a canonical request's
 * `providerOptions`. Undefined on non-Responses wires; translated adapters
 * other than the Responses path never consult it.
 */
export const responsesCarrierOf = (
  providerOptions: Record<string, unknown> | undefined,
): ResponsesNativeRequestCarrier | undefined => {
  const carrier = providerOptions?.[RESPONSES_CARRIER_OPTION_KEY] as
    | ResponsesNativeRequestCarrier | undefined;
  return carrier && typeof carrier === 'object' ? carrier : undefined;
};

/**
 * Requalify returned tool-call names through the ingress refs (spec §16.3):
 * providers echo the bare canonical name the translated/native adapter sent,
 * but the client declared (and awaits) the qualified `namespace.name`.
 * Unknown names pass through untouched — never dropped, never renamed.
 */
export const requalifyResponseToolName = (
  bareName: string,
  carrier: ResponsesNativeRequestCarrier | undefined,
): string => {
  if (!carrier) return bareName;
  const ref = carrier.functionToolRefs.find((entry) => entry.bareName === bareName);
  return ref?.qualifiedName ?? bareName;
};
