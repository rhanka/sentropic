import { NativeMessagesUpstreamError, RequestTooLargeError,
  type NativeMessagesRequest, type NativeMessagesResult } from '@sentropic/llm-mesh';
import { GATEWAY_MAX_REQUEST_BODY_BYTES } from '@sentropic/llm-gateway';
import { confirmedNativeFetch } from './anthropic-native-upload';
import { nativeReadiness } from './anthropic-native-readiness';
import { createNativeUpload, nativeHttpError, nativeResponseBytes, nativeTransportHeaders, readNativeJson,
  type NativeBodyProbe } from './anthropic-native-transport';

export interface ClaudeNativeRequest extends NativeMessagesRequest {
  readonly credential?: string;
  readonly claudeCodeTransport?: { readonly accessToken: string };
  readonly bodyProbe?: NativeBodyProbe;
  readonly onResponseStarted?: () => void;
}
export type ClaudeNativeCountRequest = Omit<ClaudeNativeRequest, 'stream' | 'finalize' | 'onResponseStarted'>;

/** One raw HTTP attempt; returned closures are constructed outside this request scope. */
export const executeClaudeNative = async (request: ClaudeNativeRequest | undefined,
  operation: 'messages' | 'count_tokens' = 'messages'): Promise<NativeMessagesResult> => {
  if (!request) throw new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' });
  if (typeof request.body.model !== 'string' || !request.body.model.trim()) {
    throw new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' });
  }
  const { signal, stream, onResponseStarted } = request;
  const headers = nativeTransportHeaders(request.headers.forwarded, request.headers.anthropicVersion,
    { credential: request.credential, accessToken: request.claudeCodeTransport?.accessToken });
  const features = { requestSafeguards: Object.hasOwn(request.body, 'safeguards'),
    sentBetas: headers.get('anthropic-beta')?.split(',') ?? [] };
  const bodyProbe = request.bodyProbe;
  bodyProbe?.('request', true);
  let upload: ReturnType<typeof createNativeUpload>;
  try { upload = createNativeUpload(request.body, bodyProbe); }
  finally { request = undefined; bodyProbe?.('request', false); }
  const base = process.env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com';
  let response: Response | undefined;
  const readiness = nativeReadiness(signal);
  let exposed = false;
  try {
    if (upload.requestBytes > GATEWAY_MAX_REQUEST_BODY_BYTES) {
      throw new RequestTooLargeError({ requestBytes: upload.requestBytes,
        limitBytes: GATEWAY_MAX_REQUEST_BODY_BYTES, source: 'gateway' });
    }
    signal.throwIfAborted();
    const path = operation === 'count_tokens' ? '/v1/messages/count_tokens' : '/v1/messages';
    response = await readiness.race(confirmedNativeFetch(`${base.replace(/\/+$/, '')}${path}`, {
      method: 'POST', headers, body: upload.stream, signal: readiness.signal,
      duplex: 'half', redirect: 'error',
    } as RequestInit, operation === 'messages' ? onResponseStarted : undefined));
    upload.complete();
    if (response.status !== 200) throw await readiness.race(nativeHttpError(response, upload.requestBytes, features));
    const responseHeaders = Object.fromEntries(response.headers);
    const requestSize = { requestBytes: upload.requestBytes, source: 'upstream' as const };
    if (operation === 'messages' && stream) {
      const body = nativeResponseBytes(response, readiness);
      exposed = true;
      return { kind: 'stream', status: 200, headers: responseHeaders, body, requestSize };
    }
    const body = await readNativeJson(response, readiness);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' });
    }
    if (operation === 'count_tokens' && (!Number.isSafeInteger((body as Record<string, unknown>).input_tokens)
      || ((body as Record<string, unknown>).input_tokens as number) < 0)) {
      throw new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' });
    }
    readiness.ready();
    return { kind: 'json', status: 200, headers: responseHeaders,
      body: body as Record<string, unknown>, requestSize };
  } catch (error) {
    await response?.body?.cancel().catch(() => undefined);
    error = readiness.failure(error);
    if (error instanceof NativeMessagesUpstreamError || error instanceof RequestTooLargeError || signal.aborted) throw error;
    throw new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' });
  } finally { upload.finish(); if (!exposed) readiness.close(); }
};
