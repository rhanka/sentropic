import type { Context, Hono } from 'hono';
import type { IdentityAuthCompletionFlowV1, IdentityAuthHonoTransactionBindingV1,
  IdentityAuthRefusalV1 } from '@sentropic/cluster-mesh';
import { withAppCmAuth } from '../../../services/identity/cm-auth-runtime';
import type { CmIdentityTransaction } from '../../../services/identity/cm-transaction';
import type { CmRegistrationPresentation } from '../../../services/identity/cm-auth-binding';
import { assertCmHostHealthy } from '../../../services/identity/cm-host-scope';

interface StagedResponse {
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
}
class HttpRefusal extends Error {
  constructor(readonly response: StagedResponse) { super('identity_http_refusal'); }
}
const publish = (response: StagedResponse): Response => new Response(
  response.status === 204 || response.status === 304 ? null : response.body,
  { status: response.status, headers: response.headers.map(([key, value]) => [key, value]) },
);
const refusalResponse = (refusal: IdentityAuthRefusalV1): Response => {
  const result = refusal.result;
  if (result && typeof result === 'object' && 'error' in result) {
    return Response.json({ error: { code: result.error.code, message: result.error.message } }, { status: result.error.status });
  }
  return Response.json({ error: { code: 'authentication_required', message: 'Authentication required.' } }, { status: 401 });
};
const captureBody = async (request: Request): Promise<ArrayBuffer | undefined> => {
  if (request.method === 'GET' || request.method === 'HEAD' || !request.body) return undefined;
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65_536) {
        await reader.cancel();
        throw new HttpRefusal({ status: 413, headers: [['content-type', 'application/json']],
          body: JSON.stringify({ error: 'request_too_large' }) });
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes.buffer;
  } finally { reader.releaseLock(); }
};
const rollbackResponse = (response: StagedResponse): StagedResponse => {
  // Only the unchanged consumer's error DTO may leave a confirmed rollback.
  const failure = JSON.parse(response.body);
  const error = typeof failure.error === 'string' ? failure.error
    : { code: failure.error.code, message: failure.error.message };
  return { status: response.status,
    headers: response.headers.filter(([key]) => ['content-type', 'cache-control', 'pragma', 'retry-after', 'www-authenticate'].includes(key)),
    body: JSON.stringify({ error, ...(typeof failure.error_description === 'string'
      ? { error_description: failure.error_description } : {}),
    ...(typeof failure.error_uri === 'string' ? { error_uri: failure.error_uri } : {}) }) };
};

/** Execute an unchanged handler on a private context; publish only a committed copy. */
export async function runCmAuthHttp(c: Context, flow: IdentityAuthCompletionFlowV1 | null,
  router: (binding: IdentityAuthHonoTransactionBindingV1, tx: CmIdentityTransaction) => Hono,
  presentation?: CmRegistrationPresentation): Promise<Response> {
  const request = c.req.raw;
  try {
    const body = await captureBody(request);
    return await withAppCmAuth(async runner => {
      const work = async (binding: IdentityAuthHonoTransactionBindingV1, tx: CmIdentityTransaction): Promise<StagedResponse> => {
        // Each retry gets fresh headers/context/body. No failed-attempt cookie survives.
        const stagedRouter = router(binding, tx);
        stagedRouter.onError(error => { throw error; });
        const response = await stagedRouter.fetch(new Request(request.url, {
          method: request.method, headers: new Headers(request.headers), body: body?.slice(0),
        }));
        const headers: [string, string][] = [...response.headers.entries()].filter(([key]) => key !== 'set-cookie');
        for (const cookie of response.headers.getSetCookie()) headers.push(['set-cookie', cookie]);
        const copy = { status: response.status, headers, body: await response.text() };
        assertCmHostHealthy(tx.hostTransaction);
        if (copy.status >= 500 || (flow !== null && copy.status >= 400)) throw new HttpRefusal(rollbackResponse(copy));
        return copy;
      };
      const trusted = presentation ? (tx: CmIdentityTransaction) => runner.registrationContext(presentation, tx) : null;
      if (flow === null) return publish(await runner.request(work, trusted));
      const outcome = await runner.complete(flow, work, trusted);
      return outcome.committed ? publish(outcome.value) : refusalResponse(outcome.refusal);
    });
  } catch (error) {
    if (error instanceof HttpRefusal) return publish(error.response);
    // Never expose a frozen-domain error message, SQL parameters or credential material.
    return Response.json({ error: { code: 'identity_unavailable', message: 'Identity service unavailable.' } }, { status: 503 });
  }
}

export const refuseCmRegistration = (): never => {
  throw new HttpRefusal({ status: 400, headers: [['content-type', 'application/json']],
    body: JSON.stringify({ error: { code: 'registration_verification_failed', message: 'Registration verification failed.' } }) });
};
