import { contentHeaders } from '@sentropic/artifacts/content/headers';
import { createHash } from 'node:crypto';
import type { ContentOrigin } from '@sentropic/artifacts/content/routing';
import { podName } from '../../../api/src/services/artifacts/live/pods';
import type { LiveKey } from '../../../api/src/services/artifacts/live/records';

export interface LiveRoute extends LiveKey {
  sessionId: string; generation: number; routeEpoch: number; podUid: string; podName: string;
  expiresAt: number;
  /** Opaque live source revision (A-LIVE live revisions): compared, never parsed. */
  sourceRevision: string;
  /** Host-asserted principal and role; an invitee has view/dev-source authority only (A-LIVE §9). */
  principalId?: string; role?: 'binding_owner' | 'invitee';
  invitationId?: string; invitationEpoch?: number;
}
export interface LiveProxyPorts {
  /** A separate session-bound source consent, current human/code rights and owner check. No release grants. */
  authorize(request: Request, artifactId: string): Promise<LiveRoute | undefined>;
  current(route: LiveRoute): Promise<boolean>;
  /** Checks the host's source staging/dependency manifest, including virtual module identities. */
  admittedPath(route: LiveRoute, path: string, query: URLSearchParams): Promise<boolean>;
  /** Revoke active sockets immediately on generation/session/grant/route changes. */
  watch(route: LiveRoute, revoke: () => void): () => void;
  /** Resolves a host-owned pages-domain Host to its artifact. Such hosts serve live routes only, never releases. */
  origin?(host: string): ContentOrigin | undefined;
  /** Host push path (`LIVE_CONTROL_PATH` on a pages-domain Host): signed revocations; undefined means refused. */
  control?(request: Request, artifactId: string): Promise<Response | undefined>;
  /** Controller push path (`LIVE_FENCE_PATH` on the internal Host): signed fences; undefined means refused. */
  fence?(request: Request): Promise<Response | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
}
export const hmrPath = (sessionId: string) => `/_live/${encodeURIComponent(sessionId)}/hmr`;
export const LIVE_CONTROL_PATH = '/_live-control/v1';
export const LIVE_FENCE_PATH = '/_live-fence/v1';
export const DEFAULT_BUILDER_NAMESPACE = 'sentropic-artifact-builders';
export function liveHeaders(mime: string, size: number, origin: string, sessionId: string, scriptHashes: string[] = []) {
  const endpoint = new URL(hmrPath(sessionId), origin); endpoint.protocol = 'wss:';
  return { ...contentHeaders({ mimeType: mime, size, mode: 'application' }),
    'cache-control': 'private, no-store',
    'content-security-policy': ["default-src 'self'", `script-src 'self' ${scriptHashes.join(' ')}`.trim(), "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:", "font-src 'self'", "media-src 'self' blob:",
      `connect-src 'self' ${endpoint.href}`, "worker-src 'none'", "child-src 'none'", "frame-src 'none'",
      "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; '),
  };
}
function safePath(url: URL) {
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return false; }
  return !path.includes('\\') && !path.includes('\0') && !path.includes('%')
    && !path.startsWith('/@fs') && !path.startsWith('/_reader') && !path.startsWith('/api')
    && !path.split('/').some(part => part === '..' || part === '.' || part.startsWith('.env')
      || ['.git', '.npmrc', '.yarnrc', '.track', 'deploy'].includes(part)
      || /\.(?:pem|key|p12|pfx)$/.test(part));
}
/** `builderNamespace` is the per-environment worker namespace that serves the live pods' Vite port. */
export function createLiveProxy(ports: LiveProxyPorts, options: { builderNamespace?: string } = {}) {
  const now = ports.now ?? Date.now;
  const namespace = options.builderNamespace ?? DEFAULT_BUILDER_NAMESPACE;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(namespace)) throw new Error('Invalid live builder namespace');
  const valid = async (route: LiveRoute) => route.podName === podName(route)
    && /^[A-Za-z0-9_-]{1,128}$/.test(route.sessionId) && route.expiresAt > now() && await ports.current(route);
  const refused = () => new Response(null, { status: 404, headers: { 'cache-control': 'private, no-store' } });
  return {
    async authorize(request: Request, artifactId: string, websocket = false) {
      const url = new URL(request.url);
      if (url.protocol !== 'https:' || url.port || (request.headers.has('origin') && request.headers.get('origin') !== url.origin)
        || request.headers.has('service-worker') || !safePath(url) || !['GET', 'HEAD'].includes(request.method)) return;
      const route = await ports.authorize(request, artifactId);
      if (!route || route.artifactId !== artifactId || !await valid(route)) return;
      const query = [...url.searchParams.entries()];
      const viteToken = query.length === 0 || (query.length === 1 && query[0][0] === 'token' && /^[A-Za-z0-9_-]{1,256}$/.test(query[0][1]));
      if (websocket ? url.pathname !== hmrPath(route.sessionId) || !viteToken
        || request.headers.get('origin') !== url.origin : !await ports.admittedPath(route, url.pathname, url.searchParams)) return;
      return { route, upstream: `http://${route.podName}.${namespace}.svc.cluster.local:5173`,
        path: url.pathname + url.search };
    },
    valid, watch: ports.watch, origin: (host: string) => ports.origin?.(host),
    control: async (request: Request, artifactId: string) => ports.control?.(request, artifactId),
    fence: async (request: Request) => ports.fence?.(request),
    async fetch(request: Request, artifactId: string): Promise<Response | undefined> {
      const admitted = await this.authorize(request, artifactId);
      if (!admitted) return new URL(request.url).pathname.startsWith('/_live/') ? refused() : undefined;
      const { route, upstream, path } = admitted;
      const response = await (ports.fetch ?? fetch)(new URL(path, upstream), {
        method: request.method, redirect: 'error', signal: AbortSignal.timeout(10_000),
        // Build a new allowlist. Cookies, tokens, Authorization, Origin and forwarding credentials never reach Vite.
        headers: { accept: request.headers.get('accept') ?? '*/*', 'accept-encoding': 'identity' },
      });
      if (response.status !== 200 || !await valid(route)) { await response.body?.cancel(); return refused(); }
      const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      if (reader) for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length;
        if (size > 16 * 1024 * 1024) { await reader.cancel(); return refused(); }
        chunks.push(chunk.value);
      }
      if (!await valid(route)) return refused();
      const mime = response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream';
      const bytes = Buffer.concat(chunks);
      // Vite's React refresh preamble is inline. Hash exact served script text; never enable unsafe-inline/eval.
      const hashes = mime === 'text/html' ? Array.from(bytes.toString('utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi),
        match => `'sha256-${createHash('sha256').update(match[1].replace(/\r\n?/g, '\n')).digest('base64')}'`) : [];
      return new Response(request.method === 'HEAD' ? null : bytes, {
        status: 200, headers: liveHeaders(mime, size, new URL(request.url).origin, route.sessionId, hashes),
      });
    },
  };
}
export type LiveProxy = ReturnType<typeof createLiveProxy>;
