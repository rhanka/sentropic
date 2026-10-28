import { randomBytes } from 'node:crypto';
import { createContentHandler, type ContentHandlerDeps } from '@sentropic/artifacts/content/handler';
import { contentHeaders, grantCookie, parseGrantCookie } from '@sentropic/artifacts/content/headers';
import { CONTENT_GRANT_TTL_SECONDS, type ContentGrantClaims, type GrantSigner, type TicketRecord } from '@sentropic/artifacts/content/grants';
import { parseContentHost } from '@sentropic/artifacts/content/routing';

export interface ContentActivationInput { flowId: string; ticketId: string; nonce: string; targetOrigin: string }
export interface ContentHostOptions {
  baseDomain: string;
  enabled(): boolean;
  grants: GrantSigner;
  current(claims: ContentGrantClaims): Promise<boolean>;
  activate(input: ContentActivationInput): Promise<TicketRecord | undefined>;
  acls: Pick<ContentHandlerDeps['acls'], 'getArtifactAcl'>;
  lifecycle: Pick<ContentHandlerDeps['lifecycle'], 'stateOf' | 'canRead'>;
  publication: {
    getCurrent(id: string): Promise<{ releaseId: string; manifest: string } | undefined>;
    getRelease(id: string): Promise<{ releaseId: string; manifest: string } | undefined>;
  };
  blobs: Pick<ContentHandlerDeps['blobs'], 'getBlob'>;
}
const NONCE_COOKIE = '__Host-artifacts_nonce';
function nonceCookie(header: string | null) {
  const values = (header ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${NONCE_COOKIE}=`));
  const value = values[0]?.slice(NONCE_COOKIE.length + 1);
  return values.length === 1 && value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
function json(status: number, value: unknown, headers: Record<string, string> = {}) {
  const body = JSON.stringify(value);
  return new Response(status === 204 ? null : body, { status, headers: {
    ...contentHeaders({ mimeType: 'application/json', size: status === 204 ? 0 : Buffer.byteLength(body) }),
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'", ...headers,
  } });
}
const fail = (status: number) => json(status, { error: status === 404 ? 'not_found' : 'content_request_refused' });

/** HTTP adaptation only. Publication and standalone package ticket redemption are unreachable. */
export function createContentHost(options: ContentHostOptions) {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(options.baseDomain) || !options.baseDomain.includes('.')) {
    throw new Error('Approved content base domain required');
  }
  const handler = createContentHandler({ ...options,
    // The upstream content handler uses only these read ports, never publication mutations.
    lifecycle: options.lifecycle as ContentHandlerDeps['lifecycle'],
    acls: options.acls as ContentHandlerDeps['acls'],
    publication: options.publication as ContentHandlerDeps['publication'],
    blobs: options.blobs as ContentHandlerDeps['blobs'],
    tickets: { async issue() { throw new Error('Public ticket issuance disabled'); },
      async redeem() { throw new Error('Standalone ticket redemption disabled'); } },
  });
  async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const origin = parseContentHost(url.host, options.baseDomain);
    if (!options.enabled() || url.protocol !== 'https:' || url.port || !origin ||
      (request.headers.has('host') && request.headers.get('host') !== url.host)) return fail(404);
    if (url.pathname === '/_reader/nonce' && request.method === 'GET') {
      if (request.headers.has('origin') && request.headers.get('origin') !== url.origin) return fail(403);
      const nonce = randomBytes(32).toString('base64url');
      return json(200, { nonce }, { 'set-cookie': `${NONCE_COOKIE}=${nonce}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=60` });
    }
    if (url.pathname === '/_reader/activate' && request.method === 'POST') {
      if (request.headers.get('origin') !== url.origin || request.headers.get('x-artifact-activation') !== '1' ||
        request.headers.get('content-type')?.split(';')[0] !== 'application/json') return fail(403);
      const nonce = nonceCookie(request.headers.get('cookie'));
      if (!nonce) return fail(403);
      // Bounded streaming read; never allocate an unbounded activation body.
      const reader = request.body?.getReader();
      let body = '';
      if (reader) {
        const decoder = new TextDecoder(); let size = 0;
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 1024) { await reader.cancel(); return fail(400); }
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
      }
      let input: { flowId: string; ticketId: string };
      try {
        input = JSON.parse(body);
        if (!input || Object.keys(input).sort().join(',') !== 'flowId,ticketId' ||
          ![input.flowId, input.ticketId].every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id))) return fail(400);
      } catch { return fail(400); }
      try {
        // W3.a resolves the current app session and commits the package flow+ticket consume.
        const consumed = await options.activate({ ...input, nonce, targetOrigin: url.origin });
        if (!consumed || consumed.ticketId !== input.ticketId || consumed.channel !== origin.kind ||
          (origin.kind === 'stable' ? consumed.artifactId !== origin.artifactId : consumed.releaseId !== origin.releaseId)) return fail(403);
        const token = options.grants.issue(consumed);
        return json(204, null, { 'set-cookie': grantCookie(token, CONTENT_GRANT_TTL_SECONDS) });
      } catch { return fail(403); }
    }
    if (!['GET', 'HEAD'].includes(request.method)) return fail(404);
    const token = parseGrantCookie(request.headers.get('cookie') ?? undefined);
    if (!token) return fail(401);
    let claims: ContentGrantClaims;
    try { claims = options.grants.verify(token); } catch { return fail(401); }
    if (!await options.current(claims)) return fail(404);
    const result = await handler.handle({ method: request.method, host: url.host,
      path: url.pathname, cookie: request.headers.get('cookie') ?? undefined });
    if (result.status === 200) {
      try { options.grants.verify(token); } catch { return fail(401); }
      if (!options.enabled() || !await options.current(claims)) return fail(404);
    }
    return new Response(request.method === 'HEAD' ? null : result.bytes ? Buffer.from(result.bytes) : JSON.stringify(result.body),
      { status: result.status, headers: result.headers });
  }
  return { async fetch(request: Request) {
    try { return await fetch(request); } catch { return fail(500); }
  } };
}
