import type { RouteAttemptUsage } from './routing-contracts.js';
import { readRequestSizeDetail, type RequestSizeDetail } from './errors.js';
import { modelProfiles } from './catalog.js';
import { EXCLUSIVE_LAUNCH_ALIAS_TARGET_MAPPINGS } from './routing-targets.js';

export type NativeInputUsageSource = 'json' | 'message_start' | 'message_delta';
export type NativeUsageUncertainty =
  | 'incomplete_input' | 'invalid_input' | 'cache_write_split_unknown'
  | 'served_model_unverified' | 'served_model_mismatch' | 'input_breakdown_changed'
  | 'incomplete_output' | 'invalid_output' | 'missing_usage';
export type NativeCacheWriteSplitReason = 'cache_write_split_inferred';
export type NativePricingPolicy = 'anthropic-cache-2026-10-02';
export type NativeUsageTermination =
  | 'completed' | 'cancelled' | 'upstream_error' | 'commit_failed'
  | 'missing_message_stop' | 'frame_overflow' | 'timeout' | 'reader_error'
  | 'protocol_error';

/** Trusted observer evidence, never populated from caller body/header fields. */
export interface NativeUsagePricing {
  readonly nativeInputPriceUnits40?: number;
  readonly nativePricingPolicy?: NativePricingPolicy;
  readonly nativeServedModelId?: string;
  readonly nativeInputUsageValidated?: boolean;
  readonly nativeInputUsageSource?: NativeInputUsageSource;
  readonly nativeUsageUncertainty?: NativeUsageUncertainty;
  /** Inferred growth allocation alone does not make a valid clean turn estimated. */
  readonly nativeCacheWriteSplitReason?: NativeCacheWriteSplitReason;
}

/** Safe provider-reported categories only; inferred TTL allocation is never raw. */
export interface NativeUsageRaw {
  readonly input_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_creation?: {
    readonly ephemeral_5m_input_tokens?: number;
    readonly ephemeral_1h_input_tokens?: number;
  };
  readonly output_tokens?: number;
}

/**
 * One immutable pre-financial-floor snapshot, shared by settlement and observation.
 * Counts are physical and optional: missing evidence never becomes zero/allowance.
 * The gateway freezes the snapshot and nested raw categories at terminal ownership.
 * Malformed/decreasing/conflicting input permanently loses its pricing proof (N5).
 */
export interface NativeUsageSnapshot extends NativeUsagePricing {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly rawUsage?: NativeUsageRaw;
  readonly estimated: boolean;
  readonly finalOutputObserved: boolean;
  readonly termination: NativeUsageTermination;
  readonly nativeSelectedModelId: string;
  readonly fallbackPresent: boolean;
  readonly iterationsPresent: boolean;
}

export interface NativeMessagesFeatureHeaders {
  /** Resolved supported version before execute; never an unresolved caller hint. */
  readonly anthropicVersion: string;
  /** Sanitized end-to-end headers; caller beta values remain opaque. */
  readonly forwarded: Readonly<Record<string, string>>;
}

export interface NativeMessagesRequest {
  readonly body: Readonly<Record<string, unknown>>;
  readonly stream: boolean;
  readonly headers: NativeMessagesFeatureHeaders;
  readonly signal: AbortSignal;
  /** Server gateway request ID, distinct from the cost correlation ID. */
  readonly requestId: string;
  /** Bound to the prepared host hook; only the gateway invokes it, once per attempt. */
  readonly finalize?: (snapshot: NativeUsageSnapshot) => void | Promise<void>;
}

/** Credential-free advertisement; executable closures remain in the trusted host. */
export interface NativeMessagesAdvertisement {
  readonly contractVersion: 1;
  readonly protocol: 'anthropic-messages';
}

export interface PreparedNativeMessages extends NativeMessagesAdvertisement {
  readonly modelId: string;
  readonly apiVersions: readonly string[];
  readonly requiredBetas: readonly string[];
  /** Trusted, body-free observation hook; settlement/cleanup never await this hook. */
  readonly finalize?: (snapshot: NativeUsageSnapshot) => void | Promise<void>;
  /** Complete/cancel upload and detach request references before exposing a result. */
  execute(request: NativeMessagesRequest): Promise<NativeMessagesResult>;
}

export type NativeMessagesResult = (
  | { readonly kind: 'json'; readonly status: 200;
      readonly body: Readonly<Record<string, unknown>>;
      readonly headers: Readonly<Record<string, string>> }
  | { readonly kind: 'stream'; readonly status: 200;
      readonly body: AsyncIterable<Uint8Array>;
      readonly headers: Readonly<Record<string, string>> }) & {
  /** Host-measured outgoing bytes, retained for numeric pre/late SSE 413 errors. */
  readonly requestSize?: RequestSizeDetail;
};

/** Empty until real qualification; trusted hosts may supply a code-only override. */
export const NATIVE_ANTHROPIC_MESSAGES_MODEL_IDS: readonly string[] = Object.freeze([]);

export const validateNativeModelAllowlist = (
  modelIds: readonly string[],
): readonly string[] => {
  for (const modelId of modelIds) {
    if (Object.hasOwn(EXCLUSIVE_LAUNCH_ALIAS_TARGET_MAPPINGS, modelId)
      || !modelProfiles.some((profile) =>
        profile.providerId === 'anthropic' && profile.modelId === modelId)) {
      throw new Error('Native Messages allowlist requires exact non-exclusive Anthropic model IDs');
    }
  }
  return Object.freeze([...modelIds]);
};

/** Pure provider/model identity check; account advertisement is a separate gate. */
export const isNativeMessagesTarget = (
  target: { readonly providerId: string; readonly modelId: string },
  modelIds: readonly string[] = NATIVE_ANTHROPIC_MESSAGES_MODEL_IDS,
): boolean => target.providerId === 'anthropic' && modelIds.includes(target.modelId);

const isNonemptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const isPreparedNativeMessages = (value: unknown): value is PreparedNativeMessages => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const capability = value as Record<string, unknown>;
  return capability.contractVersion === 1
    && capability.protocol === 'anthropic-messages'
    && isNonemptyString(capability.modelId)
    && Array.isArray(capability.apiVersions) && capability.apiVersions.length > 0
    && [...capability.apiVersions].every(isNonemptyString)
    && Array.isArray(capability.requiredBetas)
    && [...capability.requiredBetas].every((beta) => typeof beta === 'string')
    && typeof capability.execute === 'function'
    && (capability.finalize === undefined || typeof capability.finalize === 'function');
};

/** Lot 2 required betas are empty: preserve the caller's parser-retained value exactly. */
export const composeAnthropicBeta = (
  callerValue: string | undefined,
  requiredBetas: readonly string[] = [],
): string | undefined => {
  if (requiredBetas.length === 0) return callerValue;
  const required = requiredBetas.join(',');
  return callerValue === undefined ? required : `${callerValue},${required}`;
};

export type NativeMessagesProviderErrorType =
  | 'invalid_request_error' | 'authentication_error' | 'permission_error'
  | 'not_found_error' | 'request_too_large' | 'rate_limit_error'
  | 'api_error' | 'overloaded_error';

export type NativeMessagesTransportCode =
  | 'timeout' | 'account_unavailable' | 'native_protocol_error';

export interface NativeValidationPublicDetail {
  readonly type: string;
  readonly message: string;
}

export interface NativeMessagesUpstreamErrorOptions {
  readonly requestSize?: RequestSizeDetail;
  readonly status: number;
  readonly type?: NativeMessagesProviderErrorType;
  readonly code?: NativeMessagesTransportCode;
  readonly retryAfterMs?: number;
  /** Operational evidence; dispatched pre-fetch zeros do not exempt billing. */
  readonly usage?: RouteAttemptUsage;
  readonly validation?: NativeValidationPublicDetail;
}

/** Never place upstream validation prose, payloads or credentials in this error. */
export class NativeMessagesUpstreamError extends Error {
  readonly requestSize?: RequestSizeDetail;
  readonly status: number;
  readonly type?: NativeMessagesProviderErrorType;
  readonly code?: NativeMessagesTransportCode;
  readonly retryAfterMs?: number;
  readonly usage?: RouteAttemptUsage;
  readonly validation?: NativeValidationPublicDetail;

  constructor(options: NativeMessagesUpstreamErrorOptions) {
    super('Native Anthropic Messages request failed');
    this.name = 'NativeMessagesUpstreamError';
    this.status = options.status;
    this.type = options.type;
    this.code = options.code;
    this.retryAfterMs = options.retryAfterMs;
    this.usage = options.usage;
    this.validation = options.validation;
    this.requestSize = readRequestSizeDetail(options.requestSize);
  }
}
