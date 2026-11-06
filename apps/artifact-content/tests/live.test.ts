import { describe, expect, it, vi } from 'vitest';
import { createLiveProxy, hmrPath, type LiveProxyPorts, type LiveRoute } from '../src/live';
import { podName } from '../../../api/src/services/artifacts/live/pods';

function fixture() {
  const route: LiveRoute = { storageScopeId: 'scope', artifactId: 'artifact', sessionId: 'session',
    podName: '', podUid: 'uid', generation: 1, routeEpoch: 1, expiresAt: 1000, sourceRevision: 4 };
  route.podName = podName(route);
  const ports: LiveProxyPorts = { authorize: vi.fn(async () => route), current: vi.fn(async () => true),
    admittedPath: vi.fn(async () => true), watch: () => () => {}, now: () => 0,
    fetch: vi.fn(async () => new Response('<html>live</html>', { headers: { 'content-type': 'text/html',
      'set-cookie': 'untrusted=1', 'access-control-allow-origin': '*', 'content-security-policy': 'default-src *' } })) };
  return { route, ports, proxy: createLiveProxy(ports) };
}
const origin = 'https://artifact.content.example';
describe('live content proxy', () => {
  it('should require a separate live grant and strip all upstream credentials and response authority', async () => {
    const f = fixture();
    const response = await f.proxy.fetch(new Request(origin + '/', { headers: { cookie: 'host-grant',
      authorization: 'host-auth', 'x-forwarded-for': 'private', origin, accept: 'text/html' } }), 'artifact');
    expect(response?.status).toBe(200); expect(await response?.text()).toBe('<html>live</html>');
    const [, options] = vi.mocked(f.ports.fetch!).mock.calls[0];
    expect(options?.headers).toEqual({ accept: 'text/html', 'accept-encoding': 'identity' });
    expect(response?.headers.has('set-cookie')).toBe(false); expect(response?.headers.has('access-control-allow-origin')).toBe(false);
    const csp = response!.headers.get('content-security-policy')!;
    expect(csp).toContain(`wss://artifact.content.example${hmrPath('session')}`);
    expect(csp).toContain("worker-src 'none'"); expect(csp).not.toContain('unsafe-eval'); expect(csp).not.toContain('*');
    expect(response?.headers.get('cache-control')).toBe('private, no-store');
  });
  it('should preserve ordinary release routing without a live grant', async () => {
    const f = fixture(); f.ports.authorize = vi.fn(async () => undefined);
    expect(await f.proxy.fetch(new Request(origin + '/'), 'artifact')).toBeUndefined();
    expect(f.ports.fetch).not.toHaveBeenCalled();
  });
  it('should authorize the exact served Vite inline refresh preamble by hash', async () => {
    const f = fixture(); f.ports.fetch = vi.fn(async () => new Response('<script type="module">import "/@react-refresh";</script>',
      { headers: { 'content-type': 'text/html' } }));
    const response = await f.proxy.fetch(new Request(origin), 'artifact');
    const csp = response?.headers.get('content-security-policy');
    expect(csp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/]+=*'/); expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });
  it.each(['/\.env', '/nested/.env.local', '/@fs/etc/passwd', '/api/secrets', '/.git/config', '/a%5Cb', '/a%252fb'])
    ('should reject forbidden source requests %s independently of repository Vite config', async path => {
      const f = fixture(); await f.proxy.fetch(new Request(origin + path), 'artifact'); expect(f.ports.fetch).not.toHaveBeenCalled();
    });
  it('should authenticate exactly the same-origin websocket endpoint', async () => {
    const f = fixture(); const headers = { origin };
    expect(await f.proxy.authorize(new Request(origin + hmrPath('session'), { headers }), 'artifact', true)).toBeDefined();
    expect(await f.proxy.authorize(new Request(origin + hmrPath('session') + '?token=viteToken', { headers }), 'artifact', true))
      .toMatchObject({ path: hmrPath('session') + '?token=viteToken' });
    for (const path of ['/', hmrPath('another'), hmrPath('session') + '?other=1', hmrPath('session') + '?token=a&token=b']) {
      expect(await f.proxy.authorize(new Request(origin + path, { headers }), 'artifact', true)).toBeUndefined();
    }
    expect(await f.proxy.authorize(new Request(origin + hmrPath('session'), { headers: { origin: 'https://elsewhere.example' } }), 'artifact', true)).toBeUndefined();
  });
  it('should reject forged pod destinations and release-id routes', async () => {
    const f = fixture(); f.route.podName = 'arbitrary-host';
    expect(await f.proxy.fetch(new Request(origin), 'artifact')).toBeUndefined();
    f.route.podName = podName(f.route);
    expect(await f.proxy.fetch(new Request(origin), 'release-id')).toBeUndefined();
    expect(f.ports.fetch).not.toHaveBeenCalled();
  });
  it('should recheck revocation after waiting for worker bytes', async () => {
    const f = fixture(); f.ports.current = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const response = await f.proxy.fetch(new Request(origin), 'artifact'); expect(response?.status).toBe(404);
  });
  it('should refuse expired grants without contacting Vite', async () => {
    const f = fixture(); f.route.expiresAt = 0;
    await f.proxy.fetch(new Request(origin), 'artifact'); expect(f.ports.fetch).not.toHaveBeenCalled();
  });
});
