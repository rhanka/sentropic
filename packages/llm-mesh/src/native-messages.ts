import type { RouteAttemptUsage } from './routing-contracts.js';

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
  /** Complete/cancel upload and detach request references before exposing a result. */
  execute(request: NativeMessagesRequest): Promise<NativeMessagesResult>;
}

export type NativeMessagesResult =
  | { readonly kind: 'json'; readonly status: 200;
      readonly body: Readonly<Record<string, unknown>>;
      readonly headers: Readonly<Record<string, string>> }
  | { readonly kind: 'stream'; readonly status: 200;
      readonly body: AsyncIterable<Uint8Array>;
      readonly headers: Readonly<Record<string, string>> };

export type NativeMessagesProviderErrorType =
  | 'invalid_request_error' | 'authentication_error' | 'permission_error'
  | 'not_found_error' | 'request_too_large' | 'rate_limit_error'
  | 'api_error' | 'overloaded_error';

export type NativeMessagesTransportCode =
  | 'timeout' | 'account_unavailable' | 'native_protocol_error';

export interface NativeMessagesUpstreamErrorOptions {
  readonly status: number;
  readonly type?: NativeMessagesProviderErrorType;
  readonly code?: NativeMessagesTransportCode;
  readonly retryAfterMs?: number;
  /** Operational evidence; dispatched pre-fetch zeros do not exempt billing. */
  readonly usage?: RouteAttemptUsage;
}

/** Never place upstream validation prose, payloads or credentials in this error. */
export class NativeMessagesUpstreamError extends Error {
  readonly status: number;
  readonly type?: NativeMessagesProviderErrorType;
  readonly code?: NativeMessagesTransportCode;
  readonly retryAfterMs?: number;
  readonly usage?: RouteAttemptUsage;

  constructor(options: NativeMessagesUpstreamErrorOptions) {
    super('Native Anthropic Messages request failed');
    this.name = 'NativeMessagesUpstreamError';
    this.status = options.status;
    this.type = options.type;
    this.code = options.code;
    this.retryAfterMs = options.retryAfterMs;
    this.usage = options.usage;
  }
}
