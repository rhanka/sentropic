/**
 * J1.1b — artifact-content wrapper adoption of the application mode.
 *
 * The wrapper no longer appends the unconditional `worker-src 'none'` in
 * application mode; the safe default stays bit-for-bit unchanged (append
 * kept), the history fallback serves deep links only in application mode,
 * and service workers stay refused in both modes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmacGrantSigner } from '@sentropic/artifacts/content/grants';
import { grantCookie } from '@sentropic/artifacts/content/headers';
import { createContentHost, type ContentHostOptions } from '../src/host';

const artifactId = '11111111-1111-4111-8111-111111111111';
const releaseA = '22222222-2222-4222-8222-222222222222';
const baseDomain = 'content.example.test';
const stable = `https://${artifactId}.${baseDomain}`;
const bytes = new TextEncoder().encode('<h1>Private</h1>');
const manifest = JSON.stringify({ artifactId, files: [
  { path: 'index.html', digest: 'a'.repeat(64), size: bytes.length, mimeType: 'text/html' },
] });
let allowed: boolean;
let secret: string;
let now: number;
let options: ContentHostOptions;
let host: ReturnType<typeof createContentHost>;
const signer = () => createHmacGrantSigner({ secret, clock: () => now });
const cookie = () => grantCookie(signer().issue({ subjectId: 'reader', artifactId, releaseId: releaseA }), 55);
const request = (origin = stable, path = '/', init: RequestInit = {}) => host.fetch(new Request(origin + path, init));

function setup(mode?: 'safe' | 'application') {
  allowed = true; secret = 'a'.repeat(64); now = Date.now();
  options = {
    baseDomain, enabled: () => true,
    grants: { issue: (value) => signer().issue(value), verify: (token) => signer().verify(token) },
    current: vi.fn(async () => allowed),
    acls: { getArtifactAcl: vi.fn(async () => ({ ownerId: 'reader', isPublic: false, withdrawn: false,
      storageScopeId: 'scope', grants: [] })) },
    lifecycle: { stateOf: vi.fn(async () => 'active' as const), canRead: () => allowed },
    publication: { getCurrent: vi.fn(async (id: string) => id === artifactId ? { releaseId: releaseA, manifest } : undefined),
      getRelease: vi.fn(async (id: string) => id === releaseA ? { releaseId: releaseA, artifactId, manifest } : undefined) },
    blobs: { getBlob: vi.fn(async () => bytes) },
    activate: vi.fn(async () => ({ subjectId: 'reader', artifactId, releaseId: releaseA, channel: 'stable' as const,
      ticketId: 'ticket', expiresAt: now + 60000 })),
    ...(mode === undefined ? {} : { contentMode: mode }),
  };
  host = createContentHost(options);
}

describe('artifact-content application mode', () => {
  beforeEach(() => setup());

  it('keeps the safe default bit-for-bit with the unconditional worker refusal', async () => {
    setup();
    const response = await request(stable, '/', { headers: { cookie: cookie() } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("worker-src 'none'");
    expect((await request(stable, '/geo/paris', { headers: { cookie: cookie() } })).status).toBe(404);
  });

  it('serves the application policy without worker-src none', async () => {
    setup('application');
    const response = await request(stable, '/', { headers: { cookie: cookie() } });
    expect(response.status).toBe(200);
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("worker-src 'self'");
    expect(csp).not.toContain("worker-src 'none'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it('falls back to the entry only for extensionless deep links in application mode', async () => {
    setup('application');
    const deep = await request(stable, '/geo/paris', { headers: { cookie: cookie() } });
    expect(deep.status).toBe(200);
    expect(await deep.text()).toBe('<h1>Private</h1>');
    for (const path of ['/assets/missing.js', '/favicon.ico']) {
      expect((await request(stable, path, { headers: { cookie: cookie() } })).status).toBe(404);
    }
  });

  it('refuses service worker fetches in both modes', async () => {
    for (const mode of [undefined, 'application'] as const) {
      setup(mode);
      for (const path of ['/sw.js', '/service-worker.js']) {
        expect((await request(stable, path, { headers: { cookie: cookie() } })).status).toBe(404);
      }
      expect((await request(stable, '/', { headers: { cookie: cookie(), 'service-worker': 'script' } })).status)
        .not.toBe(200);
    }
  });
});
