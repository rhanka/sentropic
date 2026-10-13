import { NativeMessagesUpstreamError, requestTooLargeDetail,
  type NativeMessagesProviderErrorType, type RequestSizeDetail } from '@sentropic/llm-mesh';
import type { NativeSseFrame } from './native-sse.js';
import { parseNativeErrorDetail } from './native-errors.js';
import { toProviderShapedError } from './router/errors.js';

const statuses: Readonly<Record<NativeMessagesProviderErrorType, number>> = {
  invalid_request_error: 400, authentication_error: 401, permission_error: 403, not_found_error: 404,
  request_too_large: 413, rate_limit_error: 429, api_error: 500, overloaded_error: 529,
};
export class NativeSseUpstreamError extends NativeMessagesUpstreamError {}

/** Preserve only a known class and the bounded native validation channel. */
export const nativeFrameError = (frame: NativeSseFrame, features: {
  readonly requestSafeguards: boolean; readonly sentBetas: readonly string[];
  readonly requestSize?: RequestSizeDetail;
}): NativeSseUpstreamError | undefined => {
  let data: { type?: unknown; error?: { type?: unknown } } | undefined;
  try { data = JSON.parse(frame.data ?? ''); } catch { /* Unknown error frames are protocol failures. */ }
  if (frame.event !== 'error' && data?.type !== 'error') return undefined;
  const type = data?.error?.type;
  if (typeof type !== 'string' || !Object.hasOwn(statuses, type)) {
    return new NativeSseUpstreamError({ status: 503, code: 'native_protocol_error' });
  }
  const status = statuses[type as NativeMessagesProviderErrorType];
  let validation;
  if (status === 400) {
    try { validation = parseNativeErrorDetail(frame.data ?? '', status, features); } catch { /* Fixed public text. */ }
  }
  return new NativeSseUpstreamError({ status, type: type as NativeMessagesProviderErrorType, validation,
    ...(status === 413 ? { requestSize: features.requestSize } : {}) });
};

export const nativeLateErrorBytes = (error: unknown): Uint8Array => {
  const known = error instanceof NativeMessagesUpstreamError && error.type && Object.hasOwn(statuses, error.type);
  const tooLarge = requestTooLargeDetail(error);
  const type = tooLarge ? 'request_too_large' : known ? error.type : 'api_error';
  let message = 'stream failed after commitment';
  if (tooLarge || (known && error.status === 400)) {
    const mapped = toProviderShapedError('anthropic-messages', error);
    message = (mapped.body as { error: { message: string } }).error.message;
  }
  return new TextEncoder().encode(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type, message } })}\n\n`);
};
