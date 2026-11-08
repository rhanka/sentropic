import { resolve4 } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { createHostAssertionLive, createLiveFences } from './live-assertion';
import { CONTROL_HEADER, FENCE_HEADER, MIN_KEY_BYTES } from '@sentropic/artifacts/live-host';
import { createLiveProxy, type LiveProxyPorts } from './live';

/** Marks a replica-to-replica copy of an accepted push; a copy is applied, never relayed again. */
export const RELAY_HEADER = 'x-live-relayed';
const KID = /^[A-Za-z0-9_-]{1,64}$/;
const DOMAIN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const words = (value: string) => value.split(/[\s,]+/).filter(Boolean);

/** `kid=<unpadded base64url>` entries. Errors never echo key material. */
function keyRing(env: NodeJS.ProcessEnv, name: string) {
  const ring = new Map<string, Buffer>();
  for (const entry of words(required(env, name))) {
    const at = entry.indexOf('='); const kid = entry.slice(0, at); const material = entry.slice(at + 1);
    if (at < 1 || !KID.test(kid) || ring.has(kid) || !/^[A-Za-z0-9_-]+$/.test(material)
      || Buffer.from(material, 'base64url').length < MIN_KEY_BYTES) throw new Error(`${name} has an invalid entry`);
    ring.set(kid, Buffer.from(material, 'base64url'));
  }
  return ring;
}
function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} required for the live edge`);
  return value;
}
const under = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/**
 * Vite dev URL shapes the edge forwards: the HTML entry, staged source, Vite's own client and virtual modules, the
 * dependency closure and root static files. The pod's Vite serves only the staged closure (fs.strict, W3/W4).
 */
const VITE_PATH = /^\/(?:$|index\.html$|src\/|@vite\/(?:client|env)$|@react-refresh$|@id\/|node_modules\/|[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:svg|ico|png|jpe?g|gif|webp|webmanifest|txt|woff2?)$)/;
const VITE_QUERY = new Set(['v', 't', 'import', 'direct', 'url', 'raw', 'inline', 'html-proxy', 'index']);
export const viteAdmittedPath: LiveProxyPorts['admittedPath'] = async (_route, path, query) =>
  VITE_PATH.test(path) && [...query.keys()].every(name => VITE_QUERY.has(name));

/** Socket peer address of each inbound request, recorded by the listener; never taken from a header. */
const remoteAddresses = new WeakMap<Request, string>();
export function withRemoteAddress(request: Request, address: string | undefined) {
  if (address) remoteAddresses.set(request, address.startsWith('::ffff:') ? address.slice(7) : address);
  return request;
}

type PushPorts = Required<Pick<LiveProxyPorts, 'control' | 'fence'>>;
/**
 * Fan-out across replicas: an accepted push is copied, with its own signature, to every ready replica (self
 * included; every operation is idempotent and monotonic). 204 means every replica applied it; otherwise 503 and the
 * pusher retries. A relayed copy is applied, never relayed again, and only when its socket address is a ready
 * replica's: from any other sender, or without a recorded address, it is refused before it has any effect.
 */
export function withFanOut<T extends PushPorts>(ports: T, options: {
  peers(): Promise<string[]>; send(peer: string, request: Request, header: string): Promise<boolean>;
}): T {
  const fromPeer = async (request: Request) => {
    const address = remoteAddresses.get(request);
    return request.headers.get(RELAY_HEADER) === '1' && !!address && (await options.peers().catch((): string[] => [])).includes(address);
  };
  const relay = async (request: Request, header: string, apply: () => Promise<Response | undefined>) => {
    if (request.headers.has(RELAY_HEADER)) return await fromPeer(request) ? apply() : undefined;
    const response = await apply();
    if (response?.status !== 204) return response;
    const sent = await options.peers().then(peers => Promise.all(peers.map(peer => options.send(peer, request, header)
      .catch(() => false))), () => [false]);
    return sent.every(Boolean) ? response
      : new Response(null, { status: 503, headers: { 'cache-control': 'private, no-store', 'retry-after': '1' } });
  };
  return { ...ports,
    control: async (request: Request, artifactId: string) => relay(request, CONTROL_HEADER, () => ports.control(request, artifactId)),
    fence: async (request: Request) => relay(request, FENCE_HEADER, () => ports.fence(request)) };
}
export const httpRelay = (port: number) => (peer: string, request: Request, header: string) => new Promise<boolean>(resolve => {
  const url = new URL(request.url);
  const outgoing = httpRequest({ host: peer, port, method: 'POST', path: url.pathname, timeout: 2000, headers: {
    host: url.host, [header]: request.headers.get(header) ?? '', [RELAY_HEADER]: '1', 'content-length': '0' } });
  outgoing.once('response', response => { response.resume(); resolve(response.statusCode === 204); });
  outgoing.once('timeout', () => outgoing.destroy()); outgoing.once('error', () => resolve(false));
  outgoing.end();
});

/**
 * Composes the live edge from configuration (README « Live edge »). Absent `APP_ARTIFACT_LIVE_ENABLED=1` there is no
 * live edge; an incomplete or inconsistent configuration refuses startup.
 */
export function liveFromEnv(env: NodeJS.ProcessEnv, baseDomain: string) {
  if (env.APP_ARTIFACT_LIVE_ENABLED !== '1') return undefined;
  const hostKeys = keyRing(env, 'APP_ARTIFACT_LIVE_HOST_KEYS');
  const controllerKeys = keyRing(env, 'APP_ARTIFACT_LIVE_CONTROLLER_KEYS');
  for (const host of hostKeys.values()) for (const controller of controllerKeys.values()) {
    if (host.equals(controller)) throw new Error('Live host and controller keys must differ');
  }
  // `<pages domain>=<kid>[,<kid>...]`, one entry per whitespace-separated domain.
  const hosts = required(env, 'APP_ARTIFACT_LIVE_PAGES_DOMAINS').split(/\s+/).map(entry => {
    const [pagesDomain, kids = '', extra] = entry.split('='); const keyIds = kids.split(',').filter(Boolean);
    if (extra !== undefined || !DOMAIN.test(pagesDomain) || !pagesDomain.includes('.') || !keyIds.length
      || keyIds.some(kid => !hostKeys.has(kid)) || under(pagesDomain, baseDomain) || under(baseDomain, pagesDomain)) {
      throw new Error('APP_ARTIFACT_LIVE_PAGES_DOMAINS has an invalid entry');
    }
    return { pagesDomain, keyIds };
  });
  if (hosts.some((a, i) => hosts.some((b, j) => i !== j && under(a.pagesDomain, b.pagesDomain)))) {
    throw new Error('APP_ARTIFACT_LIVE_PAGES_DOMAINS entries overlap');
  }
  const controllerKeyIds = words(required(env, 'APP_ARTIFACT_LIVE_CONTROLLER_KEY_IDS'));
  if (controllerKeyIds.some(kid => !controllerKeys.has(kid) || hostKeys.has(kid))) {
    throw new Error('APP_ARTIFACT_LIVE_CONTROLLER_KEY_IDS has an invalid entry');
  }
  const peers = env.APP_ARTIFACT_LIVE_PEERS?.trim();
  if (peers && !DOMAIN.test(peers)) throw new Error('APP_ARTIFACT_LIVE_PEERS must be a DNS name');
  const ports = createHostAssertionLive({ hosts, key: kid => hostKeys.get(kid), fences: createLiveFences(),
    controller: { keyIds: controllerKeyIds, key: kid => controllerKeys.get(kid) }, admittedPath: viteAdmittedPath });
  const port = Number(env.ARTIFACT_CONTENT_PORT ?? '8791');
  // Without peers there is no replica to relay to, so no relayed copy is ever accepted.
  const replicas = peers ? () => resolve4(peers) : async (): Promise<string[]> => [];
  return createLiveProxy(withFanOut(ports, { peers: replicas, send: httpRelay(port) }),
    { builderNamespace: env.APP_ARTIFACT_LIVE_BUILDER_NAMESPACE?.trim() || undefined });
}
