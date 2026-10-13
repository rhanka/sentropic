import { NativeMessagesUpstreamError, type NativeMessagesRequest, type NativeMessagesResult } from '@sentropic/llm-mesh';
import { confirmedNativeFetch } from './anthropic-native-upload';
import { createNativeUpload, nativeHttpError, nativeResponseBytes, nativeTransportHeaders,
  type NativeBodyProbe } from './anthropic-native-transport';

export interface ClaudeNativeRequest extends NativeMessagesRequest {
  readonly credential?: string;
  readonly claudeCodeTransport?: { readonly accessToken: string };
  readonly bodyProbe?: NativeBodyProbe;
  readonly onResponseStarted?: () => void;
}

/** One raw HTTP attempt; returned closures are constructed outside this request scope. */
export const executeClaudeNative = async (request: ClaudeNativeRequest | undefined): Promise<NativeMessagesResult> => {
  if (!request) throw new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' });
  const { signal, stream, onResponseStarted } = request;
  const headers = nativeTransportHeaders(request.headers.forwarded, request.headers.anthropicVersion,
    { credential: request.credential, accessToken: request.claudeCodeTransport?.accessToken });
  const features = { requestSafeguards: Object.hasOwn(request.body, 'safeguards'),
    sentBetas: headers.get('anthropic-beta')?.split(',') ?? [] };
  const upload = createNativeUpload(request.body, request.bodyProbe);
  request = undefined;
  const base = process.env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com';
  let response: Response | undefined;
  try {
    signal.throwIfAborted();
    response = await confirmedNativeFetch(`${base.replace(/\/+$/, '')}/v1/messages`, {
      method: 'POST', headers, body: upload.stream, signal,
      duplex: 'half', redirect: 'error',
    } as RequestInit);
    upload.complete();
    if (response.status !== 200) throw await nativeHttpError(response, upload.requestBytes, features);
    onResponseStarted?.();
    const responseHeaders = Object.fromEntries(response.headers);
    const requestSize = { requestBytes: upload.requestBytes, source: 'upstream' as const };
    if (stream) return { kind: 'stream', status: 200, headers: responseHeaders,
      body: nativeResponseBytes(response), requestSize };
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' });
    }
    return { kind: 'json', status: 200, headers: responseHeaders,
      body: body as Record<string, unknown>, requestSize };
  } catch (error) {
    await response?.body?.cancel().catch(() => undefined);
    if (error instanceof NativeMessagesUpstreamError || signal.aborted) throw error;
    throw new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' });
  } finally { upload.finish(); }
};
