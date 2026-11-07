import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { httpRelay, liveFromEnv, RELAY_HEADER, viteAdmittedPath, withFanOut } from '../src/live-config';
import { ASSERTION_HEADER, CONTROL_HEADER, FENCE_HEADER, signLiveAssertion, signLiveFence } from '@sentropic/artifacts/live-host';
import { LIVE_CONTROL_PATH, LIVE_FENCE_PATH, type LiveRoute } from '../src/live';
import { podName } from '../../../api/src/services/artifacts/live/pods';

const artifactId = '11111111-1111-4111-8111-111111111111';
const pagesDomain = 'pages.preprod.immo.example';
const hostKey = Buffer.alloc(32, 7); const controllerKey = Buffer.alloc(32, 5);
const b64 = (key: Buffer) => key.toString('base64url');
const env = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  APP_ARTIFACT_LIVE_ENABLED: '1', APP_ARTIFACT_LIVE_PAGES_DOMAINS: `${pagesDomain}=immo-1,immo-2`,
  APP_ARTIFACT_LIVE_HOST_KEYS: `immo-1=${b64(hostKey)} immo-2=${b64(Buffer.alloc(32, 8))}`,
  APP_ARTIFACT_LIVE_CONTROLLER_KEY_IDS: 'sentropic-1', APP_ARTIFACT_LIVE_CONTROLLER_KEYS: `sentropic-1=${b64(controllerKey)}`,
  ...over,
});
const base = 'preprod.sentropic.example';
const now = () => Math.floor(Date.now() / 1000);
function assertion() {
  const claims = { v: 1 as const, kid: 'immo-1', host: `${artifactId}.${pagesDomain}`, artifactId, storageScopeId: 's',
    sessionId: 'session', generation: 1, routeEpoch: 1, podUid: 'uid', podName: '', sourceRevision: 'rev-1', principalId: 'owner',
    role: 'binding_owner' as const, invitationId: '', invitationEpoch: 0, invitationExp: 0, iat: now(), exp: now() + 60 };
  claims.podName = podName(claims);
  return signLiveAssertion(claims, hostKey);
}
const page = (path = '/') => new Request(`https://${artifactId}.${pagesDomain}${path}`, { headers: { [ASSERTION_HEADER]: assertion() } });

describe('live edge composition from configuration', () => {
  it('should stay absent unless explicitly enabled', () => {
    expect(liveFromEnv(env({ APP_ARTIFACT_LIVE_ENABLED: undefined }), base)).toBeUndefined();
    expect(liveFromEnv(env({ APP_ARTIFACT_LIVE_ENABLED: 'true' }), base)).toBeUndefined();
  });
  it('should serve the configured pages domain with keys from the secret and the per-environment namespace', async () => {
    const live = liveFromEnv(env({ APP_ARTIFACT_LIVE_BUILDER_NAMESPACE: 'workers-prod' }), base)!;
    expect(live.origin(`${artifactId}.${pagesDomain}`)).toEqual({ kind: 'id', id: artifactId });
    const admitted = await live.authorize(page('/src/main.tsx'), artifactId);
    expect(admitted?.upstream).toMatch(/\.workers-prod\.svc\.cluster\.local:5173$/);
    const fence = signLiveFence({ v: 1, kid: 'sentropic-1', artifactId, generation: 1, routeEpoch: 2, iat: now(), exp: now() + 60 }, controllerKey);
    const push = new Request(`https://artifact-content.internal:8791${LIVE_FENCE_PATH}`, { method: 'POST', headers: { [FENCE_HEADER]: fence } });
    expect((await live.fence(push))?.status).toBe(204);
    expect(await live.authorize(page('/src/main.tsx'), artifactId)).toBeUndefined();
  });
  it.each([
    ['a missing pages domain', { APP_ARTIFACT_LIVE_PAGES_DOMAINS: undefined }],
    ['a missing host key ring', { APP_ARTIFACT_LIVE_HOST_KEYS: undefined }],
    ['a missing controller key id', { APP_ARTIFACT_LIVE_CONTROLLER_KEY_IDS: undefined }],
    ['a short key', { APP_ARTIFACT_LIVE_HOST_KEYS: `immo-1=${b64(Buffer.alloc(16, 1))}` }],
    ['padded key material', { APP_ARTIFACT_LIVE_HOST_KEYS: `immo-1=${hostKey.toString('base64')}` }],
    ['a duplicate kid', { APP_ARTIFACT_LIVE_HOST_KEYS: `immo-1=${b64(hostKey)} immo-1=${b64(hostKey)}` }],
    ['a domain kid without key material', { APP_ARTIFACT_LIVE_PAGES_DOMAINS: `${pagesDomain}=immo-9` }],
    ['a domain without kid', { APP_ARTIFACT_LIVE_PAGES_DOMAINS: pagesDomain }],
    ['a pages domain under the content base domain', { APP_ARTIFACT_LIVE_PAGES_DOMAINS: `pages.${base}=immo-1` }],
    ['overlapping pages domains', { APP_ARTIFACT_LIVE_PAGES_DOMAINS: `${pagesDomain}=immo-1 a.${pagesDomain}=immo-2` }],
    ['a controller kid without key material', { APP_ARTIFACT_LIVE_CONTROLLER_KEY_IDS: 'sentropic-9' }],
    ['a controller key shared with the host', { APP_ARTIFACT_LIVE_CONTROLLER_KEYS: `sentropic-1=${b64(hostKey)}` }],
    ['a controller kid reusing a host kid', { APP_ARTIFACT_LIVE_CONTROLLER_KEY_IDS: 'immo-1',
      APP_ARTIFACT_LIVE_CONTROLLER_KEYS: `immo-1=${b64(controllerKey)}` }],
    ['an invalid builder namespace', { APP_ARTIFACT_LIVE_BUILDER_NAMESPACE: 'Bad_NS' }],
    ['an invalid peer name', { APP_ARTIFACT_LIVE_PEERS: 'peers/../x' }],
  ])('should refuse startup on %s without echoing key material', (_name, over) => {
    let message = '';
    try { liveFromEnv(env(over), base); } catch (error) { message = (error as Error).message; }
    expect(message).not.toBe(''); expect(message).not.toContain(b64(hostKey)); expect(message).not.toContain(b64(controllerKey));
  });
});

describe('edge admission of Vite dev URLs', () => {
  const route = {} as LiveRoute; const q = (value = '') => new URLSearchParams(value);
  it.each(['/', '/index.html', '/src/App.tsx', '/@vite/client', '/@react-refresh', '/@id/__x00__virtual',
    '/node_modules/.vite/deps/react.js', '/favicon.svg'])('should admit %s', async path => {
    expect(await viteAdmittedPath(route, path, q('v=abc&t=1'))).toBe(true);
  });
  it.each([['/package.json', ''], ['/vite.config.ts', ''], ['/scripts/x.js', ''], ['/src/a.ts', 'proxy=1']])(
    'should refuse %s %s', async (path, query) => { expect(await viteAdmittedPath(route, path, q(query))).toBe(false); });
});

describe('fan-out across replicas', () => {
  const accepted = () => new Response(null, { status: 204 });
  const ports = () => ({ control: vi.fn(async (_request: Request, _artifactId: string): Promise<Response | undefined> => accepted()),
    fence: vi.fn(async (_request: Request): Promise<Response | undefined> => accepted()) });
  const sender = () => vi.fn(async (_peer: string, _request: Request, _header: string) => true);
  const request = (headers: Record<string, string> = {}) => new Request('https://h.example/_live-fence/v1', { method: 'POST', headers });
  it('should copy an accepted push to every replica and answer 204 only when all applied it', async () => {
    const send = sender(); const relay = withFanOut(ports(), { peers: async () => ['10.0.0.1', '10.0.0.2'], send });
    expect((await relay.fence(request({ [FENCE_HEADER]: 'f1.x.y' })))?.status).toBe(204);
    expect(send.mock.calls.map(call => [call[0], call[2]])).toEqual([['10.0.0.1', FENCE_HEADER], ['10.0.0.2', FENCE_HEADER]]);
    send.mockResolvedValueOnce(false);
    expect((await relay.control(request(), 'a'))?.status).toBe(503);
    expect((await withFanOut(ports(), { peers: async () => { throw new Error('dns'); }, send }).fence(request()))?.status).toBe(503);
  });
  it('should neither relay a relayed copy nor a refused push', async () => {
    const send = sender(); const inner = ports(); inner.fence.mockResolvedValueOnce(undefined);
    const relay = withFanOut(inner, { peers: async () => ['10.0.0.1'], send });
    expect(await relay.fence(request())).toBeUndefined();
    expect((await relay.fence(request({ [RELAY_HEADER]: '1' })))?.status).toBe(204);
    expect(send).not.toHaveBeenCalled();
  });
  it('should relay over HTTP with the original Host, the signed header and the relay marker only', async () => {
    let seen: { method?: string; url?: string; headers: IncomingHttpHeaders } | undefined;
    const server = createServer((req, res) => { seen = { method: req.method, url: req.url, headers: req.headers }; res.writeHead(204).end(); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const original = new Request(`https://${artifactId}.${pagesDomain}${LIVE_CONTROL_PATH}`,
        { method: 'POST', headers: { [CONTROL_HEADER]: 'c1.a.b', cookie: 'secret' } });
      expect(await httpRelay(port)('127.0.0.1', original, CONTROL_HEADER)).toBe(true);
      expect(seen).toMatchObject({ method: 'POST', url: LIVE_CONTROL_PATH,
        headers: { host: `${artifactId}.${pagesDomain}`, [CONTROL_HEADER]: 'c1.a.b', [RELAY_HEADER]: '1' } });
      expect(seen?.headers.cookie).toBeUndefined();
      expect(await httpRelay(port)('127.0.0.2', original, CONTROL_HEADER)).toBe(false);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});
