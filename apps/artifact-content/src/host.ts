import { randomBytes } from 'node:crypto';
import { createContentHandler, type ContentHandlerDeps } from '@sentropic/artifacts/content/handler';
import { contentHeaders, GRANT_COOKIE_NAME, grantCookie, parseGrantCookie, type ContentMode } from '@sentropic/artifacts/content/headers';
import { CONTENT_GRANT_TTL_SECONDS, type ContentGrantClaims, type GrantSigner, type TicketRecord } from '@sentropic/artifacts/content/grants';
import { parseContentHost } from '@sentropic/artifacts/content/routing';
import { LIVE_CONTROL_PATH, LIVE_FENCE_PATH, type LiveProxy } from './live';

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
    getRelease(id: string): Promise<{ releaseId: string; artifactId: string; manifest: string } | undefined>;
  };
  blobs: Pick<ContentHandlerDeps['blobs'], 'getBlob'>;
  /** G1 owner Q2: live account approval re-checked on every content read (fail-closed when absent). */
  isApprovedAccount?: (principalId: string) => boolean | Promise<boolean>;
  /** Host-configured mode (owner decision 05/11): `safe` default, `application` for real SPAs. */
  contentMode?: ContentMode;
  /** Per-release inline script hashes for the served HTML file, application mode only. */
  getScriptHashes?: (filePath: string) => readonly string[] | undefined;
  live?: LiveProxy;
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
    const releaseOrigin = parseContentHost(url.host, options.baseDomain);
    const liveOrigin = releaseOrigin ? undefined : options.live?.origin(url.host);
    const origin = releaseOrigin ?? liveOrigin;
    // Controller fences arrive on the internal service Host only, never on a public content or pages host.
    const publicHost = url.hostname === options.baseDomain || url.hostname.endsWith(`.${options.baseDomain}`);
    if (!origin && !publicHost && url.pathname === LIVE_FENCE_PATH && options.enabled() && options.live
      && (!request.headers.has('host') || request.headers.get('host') === url.host)) return await options.live.fence(request) ?? fail(404);
    if (!options.enabled() || url.protocol !== 'https:' || url.port || !origin ||
      (request.headers.has('host') && request.headers.get('host') !== url.host)) return fail(404);
    const cookies = request.headers.get('cookie') ?? '';
    if (cookies.length > 4096) return fail(400);
    if (request.headers.has('service-worker')) return fail(404);
    if (liveOrigin && url.pathname === LIVE_CONTROL_PATH) return await options.live?.control(request, origin.id) ?? fail(404);
    const live = await options.live?.fetch(request, origin.id);
    if (live) return live;
    // A host-owned pages domain serves live routes only: no release, reader or activation path exists there.
    if (liveOrigin) return fail(404);
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
        if (!consumed || consumed.ticketId !== input.ticketId ||
          (consumed.channel === 'stable' ? consumed.artifactId : consumed.releaseId) !== origin.id) return fail(403);
        const token = options.grants.issue(consumed);
        return json(204, null, { 'set-cookie': grantCookie(token, CONTENT_GRANT_TTL_SECONDS) });
      } catch { return fail(403); }
    }
    if (url.pathname === '/_reader' || url.pathname.startsWith('/_reader/') || !['GET', 'HEAD'].includes(request.method)) return fail(404);
    if (cookies.split(';').filter(part => part.trim().startsWith(`${GRANT_COOKIE_NAME}=`)).length !== 1) return fail(401);
    const token = parseGrantCookie(cookies);
    if (!token) return fail(401);
    let claims: ContentGrantClaims;
    try { claims = options.grants.verify(token); } catch { return fail(401); }
    if (!await options.current(claims)) return fail(404);
    const result = await handler.handle({ method: request.method, host: url.host,
      path: url.pathname, cookie: request.headers.get('cookie') ?? undefined,
      accept: request.headers.get('accept') ?? undefined });
    if (result.status === 200) {
      // An artifact id follows the current release (fresh consent on republish); a release id is frozen.
      const current = await options.publication.getCurrent(origin.id);
      if (current !== undefined && current.releaseId !== claims.releaseId) return fail(401);
      try { options.grants.verify(token); } catch { return fail(401); }
      if (!options.enabled() || !await options.current(claims)) return fail(404);
    }
    // Safe mode keeps the historic unconditional worker refusal; application
    // mode serves `worker-src 'self'` from the handler instead.
    if ((options.contentMode ?? 'safe') === 'safe' && result.headers['content-security-policy']) {
      result.headers['content-security-policy'] += "; worker-src 'none'";
    }
    return new Response(request.method === 'HEAD' ? null : result.bytes ? Buffer.from(result.bytes) : JSON.stringify(result.body),
      { status: result.status, headers: result.headers });
  }
  return { async fetch(request: Request) {
    let response: Response;
    try { response = await fetch(request); } catch { response = fail(500); }
    return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
  } };
}
