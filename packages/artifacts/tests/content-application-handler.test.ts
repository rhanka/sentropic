/**
 * J1.1a — content handler modes (owner decision 05/11).
 *
 * Safe stays bit-for-bit the historic 404 behaviour; application mode serves
 * the reference SPA shape (entry, module script, deep link) with zero policy
 * denials, falls back to the entry only for extensionless HTML navigations,
 * keeps missing assets at 404 and refuses service workers in both modes.
 */
import { describe, expect, it } from 'vitest';
import { APPLICATION_HTML_CSP } from '../src/content/headers.js';
import { createContentHandler, type ContentHandlerDeps } from '../src/content/handler.js';
import { createHmacGrantSigner } from '../src/content/grants.js';
import { grantCookie } from '../src/content/headers.js';
import type { AclStore } from '../src/server/access.js';
import type { LifecycleService } from '../src/server/lifecycle.js';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const RELEASE = '22222222-2222-4222-8222-222222222222';
const BASE = 'content.example.test';
const HOST = `${ARTIFACT}.${BASE}`;
const SECRET = 'a'.repeat(64);

const HTML = '<!doctype html><html><head></head><body>app</body></html>';
const JS = 'console.log("app")';
const htmlBytes = new TextEncoder().encode(HTML);
const jsBytes = new TextEncoder().encode(JS);
const manifest = JSON.stringify({ artifactId: ARTIFACT, files: [
  { path: 'index.html', digest: `sha256:${'a'.repeat(64)}`, size: htmlBytes.length, mimeType: 'text/html' },
  { path: 'assets/app.js', digest: `sha256:${'b'.repeat(64)}`, size: jsBytes.length, mimeType: 'text/javascript' },
] });

function handlerFor(mode: 'safe' | 'application') {
  const signer = createHmacGrantSigner({ secret: SECRET });
  const handler = createContentHandler({
    acls: { getArtifactAcl: async () => ({ ownerId: 'reader', storageScopeId: 'scope', grants: [] }) } as unknown as AclStore,
    lifecycle: { stateOf: async () => 'active', canRead: () => true } as unknown as LifecycleService,
    publication: {
      getCurrent: async (id: string) => id === ARTIFACT ? { releaseId: RELEASE, manifest } : undefined,
      getRelease: async (id: string) => id === RELEASE ? { releaseId: RELEASE, artifactId: ARTIFACT, manifest } : undefined,
    },
    blobs: {
      getBlob: async (key: string) => key.endsWith('a'.repeat(64)) ? htmlBytes : jsBytes,
    },
    grants: signer,
    tickets: { issue: async () => { throw new Error('unused'); }, redeem: async () => { throw new Error('unused'); } } as unknown as ContentHandlerDeps['tickets'],
    baseDomain: BASE,
    isApprovedAccount: () => true,
    contentMode: mode,
  });
  const token = signer.issue({ subjectId: 'reader', artifactId: ARTIFACT, releaseId: RELEASE });
  const cookie = grantCookie(token, 55);
  const get = (path: string, accept?: string) => handler.handle({ method: 'GET', host: HOST, path, cookie,
    ...(accept === undefined ? {} : { accept }) });
  return { get };
}

describe('content handler modes', () => {
  it('serves the reference SPA shape with zero policy denials in application mode', async () => {
    const { get } = handlerFor('application');
    // Entry, module script, deep link: all 200 under one policy.
    const entry = await get('/');
    expect(entry.status).toBe(200);
    expect(entry.headers['content-security-policy']).toBe(APPLICATION_HTML_CSP);
    const script = await get('/assets/app.js');
    expect(script.status).toBe(200);
    expect(script.headers['content-security-policy']).toBe(APPLICATION_HTML_CSP);
    expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8');
    // Module worker (worker-src self), computed styles (style-src
    // unsafe-inline), deep link (history fallback): locked below.
    const deep = await get('/geo/paris');
    expect(deep.status).toBe(200);
    expect(deep.bytes).toEqual(htmlBytes);
    expect(deep.headers['content-security-policy']).toBe(APPLICATION_HTML_CSP);
  });

  it('keeps the 404 behaviour bit-for-bit in safe mode, with a snapshot', async () => {
    const { get } = handlerFor('safe');
    expect((await get('/geo/paris')).status).toBe(404);
    expect((await get('/assets/missing.js')).status).toBe(404);
    const missing = await get('/assets/missing.js');
    expect({ status: missing.status, headers: missing.headers, body: missing.body }).toMatchSnapshot();
  });

  it('returns 404 for a missing asset, never the fallback, in application mode', async () => {
    const { get } = handlerFor('application');
    for (const path of ['/assets/missing.js', '/assets/app.css', '/favicon.ico', '/geo/']) {
      const response = await get(path);
      expect(response.status).toBe(404);
      expect(response.bytes).toBeUndefined();
    }
  });

  it('refuses service worker registration in both modes', async () => {
    for (const mode of ['safe', 'application'] as const) {
      const { get } = handlerFor(mode);
      expect((await get('/sw.js')).status).toBe(404);
      expect((await get('/service-worker.js')).status).toBe(404);
      expect((await get('/assets/sw.js')).status).toBe(404);
    }
  });

  it('never falls back on reader protocol paths', async () => {
    const { get } = handlerFor('application');
    expect((await get('/_reader/status')).status).toBe(404);
  });

  it('only falls back for HTML navigations', async () => {
    const { get } = handlerFor('application');
    expect((await get('/geo/paris', 'text/html')).status).toBe(200);
    expect((await get('/geo/paris', 'application/json')).status).toBe(404);
  });
});
