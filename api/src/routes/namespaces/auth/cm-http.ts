import type { Context, Hono } from 'hono';
import type { IdentityAuthCompletionFlowV1, IdentityAuthHonoTransactionBindingV1,
  IdentityAuthRefusalV1 } from '@sentropic/cluster-mesh';
import { withAppCmAuth } from '../../../services/identity/cm-auth-runtime';

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

/** Execute an unchanged handler on a private context; publish only a committed copy. */
export async function runCmAuthHttp(c: Context, flow: IdentityAuthCompletionFlowV1 | null,
  router: (binding: IdentityAuthHonoTransactionBindingV1) => Hono): Promise<Response> {
  const request = c.req.raw;
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
  try {
    return await withAppCmAuth(async runner => {
      const work = async (binding: IdentityAuthHonoTransactionBindingV1): Promise<StagedResponse> => {
        // Each retry gets fresh headers/context/body. No failed-attempt cookie survives.
        const response = await router(binding).fetch(new Request(request.url, {
          method: request.method, headers: new Headers(request.headers), body: body?.slice(0),
        }));
        const headers: [string, string][] = [...response.headers.entries()].filter(([key]) => key !== 'set-cookie');
        for (const cookie of response.headers.getSetCookie()) headers.push(['set-cookie', cookie]);
        const copy = { status: response.status, headers, body: await response.text() };
        if (copy.status >= 400) throw new HttpRefusal(copy);
        return copy;
      };
      if (flow === null) return publish(await runner.request(work));
      const outcome = await runner.complete(flow, work);
      return outcome.committed ? publish(outcome.value) : refusalResponse(outcome.refusal);
    });
  } catch (error) {
    if (error instanceof HttpRefusal) return publish(error.response);
    // Never expose a frozen-domain error message, SQL parameters or credential material.
    return Response.json({ error: { code: 'identity_unavailable', message: 'Identity service unavailable.' } }, { status: 503 });
  }
}
