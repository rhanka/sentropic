import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmacGrantSigner } from '@sentropic/artifacts/content/grants';
import { grantCookie } from '@sentropic/artifacts/content/headers';
import { createContentHost, type ContentHostOptions } from '../src/host';

const artifactId = '11111111-1111-4111-8111-111111111111';
const releaseA = '22222222-2222-4222-8222-222222222222';
const releaseB = '33333333-3333-4333-8333-333333333333';
const baseDomain = 'content.example.test';
const stable = `https://${artifactId}.${baseDomain}`;
const pinned = `https://${releaseA}.pinned.${baseDomain}`;
const bytes = new TextEncoder().encode('<h1>Private</h1>');
const manifest = JSON.stringify({ artifactId, files: [
  { path: 'index.html', digest: 'a'.repeat(64), size: bytes.length, mimeType: 'text/html' },
] });
let allowed: boolean;
let currentRelease: string;
let secret: string;
let now: number;
let options: ContentHostOptions;
let host: ReturnType<typeof createContentHost>;
const signer = () => createHmacGrantSigner({ secret, clock: () => now });
const cookie = (releaseId = releaseA) => grantCookie(signer().issue({ subjectId: 'reader', artifactId, releaseId }), 55);
const request = (origin = stable, path = '/', init: RequestInit = {}) => host.fetch(new Request(origin + path, init));

beforeEach(() => {
  allowed = true; currentRelease = releaseA; secret = 'a'.repeat(64); now = Date.now();
  options = {
    baseDomain, enabled: () => true,
    grants: { issue: value => signer().issue(value), verify: token => signer().verify(token) },
    current: vi.fn(async () => allowed),
    acls: { getArtifactAcl: vi.fn(async () => ({ ownerId: 'reader', isPublic: false, withdrawn: false,
      storageScopeId: 'scope', grants: [] })) },
    lifecycle: { stateOf: vi.fn(async () => 'active' as const), canRead: () => allowed },
    publication: { getCurrent: vi.fn(async () => ({ releaseId: currentRelease, manifest })),
      getRelease: vi.fn(async (id: string) => [releaseA, releaseB].includes(id) ? { releaseId: id, manifest } : undefined) },
    blobs: { getBlob: vi.fn(async () => bytes) },
    activate: vi.fn(async () => ({ subjectId: 'reader', artifactId, releaseId: releaseA, channel: 'stable' as const,
      ticketId: 'ticket', expiresAt: now + 60000 })),
  };
  host = createContentHost(options);
});

describe('app private content host', () => {
  it('should serve approved stable and pinned hosts through private blob ports', async () => {
    for (const origin of [stable, pinned]) {
      const response = await request(origin, '/', { headers: { cookie: cookie() } });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('<h1>Private</h1>');
    }
    expect(options.blobs.getBlob).toHaveBeenCalledWith(`artifacts/scope/blobs/sha256/${'a'.repeat(64)}`);
  });

  it.each(['https://unknown.example.test', `https://${artifactId}.foreign.test`,
    `https://${artifactId}.extra.${baseDomain}`, `http://${artifactId}.${baseDomain}`, `${stable}:444`])(
    'should deny unapproved host %s before private storage', async origin => {
      expect((await request(origin, '/', { headers: { cookie: cookie() } })).status).toBe(404);
      expect(options.blobs.getBlob).not.toHaveBeenCalled();
      expect(options.publication.getCurrent).not.toHaveBeenCalled();
    });

  it('should retain isolation headers and omit bytes for HEAD', async () => {
    const response = await request(stable, '/', { method: 'HEAD', headers: { cookie: cookie() } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(response.headers.get('content-security-policy')).toContain("worker-src 'none'");
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('should require fresh stable consent after publish while pinned A still reads', async () => {
    currentRelease = releaseB;
    expect((await request(stable, '/', { headers: { cookie: cookie() } })).status).toBe(401);
    expect((await request(stable, '/', { headers: { cookie: cookie(releaseB) } })).status).toBe(200);
    expect((await request(pinned, '/', { headers: { cookie: cookie() } })).status).toBe(200);
  });

  it('should deny absent grants, forged identity headers, raw blobs and ticket shortcuts', async () => {
    expect((await request(stable, '/?ticket=forged', { headers: { 'x-subject-id': 'reader' } })).status).toBe(401);
    for (const path of ['/artifacts/scope/blobs/sha256/' + 'a'.repeat(64), '/sw.js', '/missing']) {
      expect((await request(stable, path, { headers: { cookie: cookie() } })).status).toBe(404);
    }
    expect(options.blobs.getBlob).not.toHaveBeenCalled();
  });

  it('should deny key rotation, expiry and revoked authority on the next request', async () => {
    const previous = cookie();
    secret = 'b'.repeat(64);
    expect((await request(stable, '/', { headers: { cookie: previous } })).status).toBe(401);
    const fresh = cookie();
    allowed = false;
    expect((await request(stable, '/', { headers: { cookie: fresh } })).status).toBe(404);
    allowed = true; now += 60000;
    expect((await request(stable, '/', { headers: { cookie: fresh } })).status).toBe(401);
    expect(options.blobs.getBlob).not.toHaveBeenCalled();
  });

  it.each(['authority', 'key'])('should discard private bytes when %s changes during storage waits', async change => {
    vi.mocked(options.blobs.getBlob).mockImplementation(async () => {
      if (change === 'authority') allowed = false;
      else secret = 'b'.repeat(64);
      return bytes;
    });
    const response = await request(stable, '/', { headers: { cookie: cookie() } });
    expect(response.status).toBe(change === 'authority' ? 404 : 401);
    expect(await response.text()).not.toContain('Private');
  });

  it('should require fresh stable consent when the pointer advances during a blob wait', async () => {
    vi.mocked(options.blobs.getBlob).mockImplementation(async () => { currentRelease = releaseB; return bytes; });
    const response = await request(stable, '/', { headers: { cookie: cookie() } });
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('Private');
    expect((await request(pinned, '/', { headers: { cookie: cookie() } })).status).toBe(200);
  });

  it('should return no body for denied HEAD requests', async () => {
    expect(await (await request(stable, '/', { method: 'HEAD' })).text()).toBe('');
  });

  it('should deny ambiguous grant cookies, cookie flooding and service-worker script fetches', async () => {
    const value = cookie();
    const cases: Record<string,string>[] = [{ cookie: value + '; ' + value }, { cookie: value + '; extra=' + 'a'.repeat(8192) },
      { cookie: value, 'service-worker': 'script' }];
    for (const headers of cases) {
      expect((await request(stable, '/', { headers })).status).not.toBe(200);
    }
    expect(options.blobs.getBlob).not.toHaveBeenCalled();
  });

  it('should reserve every reader path ahead of generated bundle routing', async () => {
    expect((await request(stable, '/_reader/activate', { headers: { cookie: cookie() } })).status).toBe(404);
    expect(options.publication.getCurrent).not.toHaveBeenCalled();
  });

  it('should fail closed on storage errors and when serving is disabled', async () => {
    vi.mocked(options.blobs.getBlob).mockRejectedValue(new Error('private backend detail'));
    const response = await request(stable, '/', { headers: { cookie: cookie() } });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('backend detail');
    options.enabled = () => false;
    expect((await request(stable, '/', { headers: { cookie: cookie() } })).status).toBe(404);
  });
});

describe('content browser activation transport', () => {
  const bootstrap = () => request(stable, '/_reader/nonce');
  async function activate(extra: HeadersInit = {}, body = { flowId: 'flow', ticketId: 'ticket' }) {
    const started = await bootstrap();
    const headers = { origin: stable, 'content-type': 'application/json', 'x-artifact-activation': '1',
      cookie: started.headers.get('set-cookie')!, ...extra };
    return request(stable, '/_reader/activate', { method: 'POST', headers, body: JSON.stringify(body) });
  }

  it('should bind a host-only browser nonce and sign only the acknowledged consume', async () => {
    const started = await bootstrap();
    expect(started.status).toBe(200);
    expect((await started.json()).nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(started.headers.get('set-cookie')).toMatch(/^__Host-artifacts_nonce=.+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=60$/);
    const response = await activate();
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('__Host-artifacts_grant=');
    expect(response.headers.get('set-cookie')).not.toContain('Domain=');
    expect(options.activate).toHaveBeenCalledWith(expect.objectContaining({ flowId: 'flow', ticketId: 'ticket', targetOrigin: stable,
      nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) }));
  });

  it.each<Record<string,string>>([{ origin: 'https://evil.test' }, { origin: '' }, { 'x-artifact-activation': '' },
    { 'content-type': 'text/plain' }, { cookie: '' }])('should refuse unbound browser activation %j', async headers => {
    expect((await activate(headers)).status).toBe(403);
    expect(options.activate).not.toHaveBeenCalled();
  });

  it('should refuse forged body identity, duplicate nonce cookies and foreign bootstrap origins', async () => {
    expect((await activate({}, { flowId: 'flow', ticketId: 'ticket', subjectId: 'owner' } as never)).status).toBe(400);
    expect((await activate({ cookie: '__Host-artifacts_nonce=a; __Host-artifacts_nonce=b' })).status).toBe(403);
    expect((await request(stable, '/_reader/nonce', { headers: { origin: 'https://evil.test' } })).status).toBe(403);
    expect(options.activate).not.toHaveBeenCalled();
  });

  it.each(['denied', 'uncertain', 'wrong-target'])('should emit no cookie on %s consume', async failure => {
    vi.mocked(options.activate).mockImplementation(async () => {
      if (failure === 'uncertain') throw new Error('commit outcome unknown');
      if (failure === 'denied') return undefined;
      return { subjectId: 'reader', artifactId, releaseId: releaseB, channel: 'pinned', ticketId: 'ticket', expiresAt: now + 60000 };
    });
    const response = await activate();
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
