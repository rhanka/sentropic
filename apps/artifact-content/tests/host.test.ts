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
    acls: { getArtifactAcl: vi.fn(async () => ({ artifactId, ownerId: 'reader', visibility: 'private',
      storageScopeId: 'scope', grants: {} })) },
    lifecycle: { stateOf: vi.fn(async () => 'active'), canRead: () => allowed },
    publication: { getCurrent: vi.fn(async () => ({ releaseId: currentRelease, manifest })),
      getRelease: vi.fn(async id => [releaseA, releaseB].includes(id) ? { releaseId: id, manifest } : undefined) },
    blobs: { getBlob: vi.fn(async () => bytes) },
    activate: vi.fn(async () => ({ subjectId: 'reader', artifactId, releaseId: releaseA, channel: 'stable',
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
});
