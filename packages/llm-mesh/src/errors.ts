import type { ProviderId } from './providers.js';

export type ProviderErrorRetryReason =
  | 'rate_limit'
  | 'timeout'
  | 'server_error'
  | 'network'
  | 'overloaded'
  | 'unknown';

export interface NormalizedProviderError {
  providerId: ProviderId;
  message: string;
  code?: string;
  retryable: boolean;
  retryReason?: ProviderErrorRetryReason;
  retryAfterMs?: number;
  statusCode?: number;
  cause?: unknown;
  metadata?: Record<string, unknown>;
}

export interface ProviderErrorNormalizationOptions {
  defaultMessage?: string;
  retryableCodes?: readonly string[];
  nonRetryableCodes?: readonly string[];
  retryableStatusCodes?: readonly number[];
}

const defaultRetryableStatusCodes = [408, 409, 425, 429, 500, 502, 503, 504] as const;
const defaultRetryableCodes = [
  'rate_limit',
  'rate_limit_exceeded',
  'timeout',
  'server_error',
  'overloaded',
  'temporarily_unavailable',
] as const;

const asRecord = (value: unknown): Record<string, unknown> | null => {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
};

const readString = (record: Record<string, unknown> | null, key: string): string | undefined => {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
};

const readNumber = (record: Record<string, unknown> | null, key: string): number | undefined => {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const nestedErrorRecord = (record: Record<string, unknown> | null): Record<string, unknown> | null => {
  return asRecord(record?.error) || asRecord(record?.response);
};

const inferRetryReason = (
  statusCode: number | undefined,
  code: string | undefined,
): ProviderErrorRetryReason | undefined => {
  const normalizedCode = code?.toLowerCase();
  if (statusCode === 429 || normalizedCode?.includes('rate')) return 'rate_limit';
  if (statusCode === 408 || normalizedCode?.includes('timeout')) return 'timeout';
  if (statusCode === 409 || statusCode === 425 || normalizedCode?.includes('overload')) {
    return 'overloaded';
  }
  if (typeof statusCode === 'number' && statusCode >= 500) return 'server_error';
  if (normalizedCode?.includes('network') || normalizedCode === 'fetch_error') return 'network';
  return undefined;
};

export const isRetryableProviderError = (
  statusCode: number | undefined,
  code: string | undefined,
  options: ProviderErrorNormalizationOptions = {},
): boolean => {
  const retryableStatusCodes: readonly number[] =
    options.retryableStatusCodes ?? defaultRetryableStatusCodes;
  const retryableCodes: readonly string[] = options.retryableCodes ?? defaultRetryableCodes;
  const nonRetryableCodes: readonly string[] = options.nonRetryableCodes ?? [];

  if (code && nonRetryableCodes.includes(code)) return false;
  if (typeof statusCode === 'number' && retryableStatusCodes.includes(statusCode)) return true;
  if (!code) return false;

  const normalizedCode = code.toLowerCase();
  return retryableCodes.some((retryableCode) => normalizedCode.includes(retryableCode));
};

export const normalizeProviderError = (
  providerId: ProviderId,
  error: unknown,
  options: ProviderErrorNormalizationOptions = {},
): NormalizedProviderError => {
  const record = asRecord(error);
  const nested = nestedErrorRecord(record);
  const statusCode =
    readNumber(record, 'statusCode') ||
    readNumber(record, 'status') ||
    readNumber(nested, 'statusCode') ||
    readNumber(nested, 'status');
  const code =
    readString(record, 'code') ||
    readString(record, 'type') ||
    readString(nested, 'code') ||
    readString(nested, 'status');
  const message =
    readString(record, 'message') ||
    readString(nested, 'message') ||
    (error instanceof Error && error.message) ||
    options.defaultMessage ||
    `${providerId} request failed`;
  const retryAfterSeconds =
    readNumber(record, 'retryAfter') || readNumber(nested, 'retryAfter');
  const retryAfterMs =
    readNumber(record, 'retryAfterMs') ||
    readNumber(nested, 'retryAfterMs') ||
    (typeof retryAfterSeconds === 'number' ? retryAfterSeconds * 1000 : undefined);
  const retryable = isRetryableProviderError(statusCode, code, options);
  const retryReason = retryable ? inferRetryReason(statusCode, code) ?? 'unknown' : undefined;

  return {
    providerId,
    message,
    retryable,
    ...(code ? { code } : {}),
    ...(retryReason ? { retryReason } : {}),
    ...(retryAfterMs ? { retryAfterMs } : {}),
    ...(typeof statusCode === 'number' ? { statusCode } : {}),
    ...(error instanceof Error || record ? { cause: error } : {}),
  };
};
