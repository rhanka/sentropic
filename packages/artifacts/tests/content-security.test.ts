/**
 * L-5d — content security headers, grant cookie and reader API profile
 * (spec-v8 §9 5d): untrusted HTML never rides the control origin's trust
 * (nosniff, frame denial, restrictive CSP, no-store), the grant cookie is
 * host-only, and reader business calls need exact profile + origin/CSRF
 * checks with reader attribution.
 */
import { describe, expect, it } from 'vitest';
import {
  GRANT_COOKIE_NAME,
  contentHeaders,
  grantCookie,
  parseGrantCookie,
} from '../src/content/headers.js';
import { authorizeReaderApiCall } from '../src/content/api-profile.js';
import type { ReaderProfile } from '../src/server/reader-profile.js';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const RELEASE = '22222222-2222-4222-8222-222222222222';
const ORIGIN = `https://${ARTIFACT}.pages.example.test`;

const profile: ReaderProfile = {
  ownerId: 'farid',
  subjects: ['steve'],
  allowApprovedAccounts: false,
  methods: ['GET', 'POST'],
  routes: ['/api/notes'],
  artifactId: ARTIFACT,
  releaseId: RELEASE,
};

describe('content headers', () => {
  it.each(['text/html', 'text/css', 'image/png'])('should isolate %s from sibling origins', (mimeType) => {
    for (const assetCacheSeconds of [undefined, 300]) {
      expect(contentHeaders({ mimeType, size: 7, assetCacheSeconds })['cross-origin-resource-policy'])
        .toBe('same-origin');
    }
  });

  it('serves HTML no-store with nosniff, frame denial and a restrictive CSP', () => {
    const headers = contentHeaders({ mimeType: 'text/html', size: 42 });
    expect(headers['content-type']).toBe('text/html; charset=utf-8');
    expect(headers['content-length']).toBe('42');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy']).not.toContain('*');
  });

  it('caches assets only when the host explicitly allows it', () => {
    expect(contentHeaders({ mimeType: 'text/css', size: 7 })['cache-control']).toBe('no-store');
    const cached = contentHeaders({ mimeType: 'text/css', size: 7, assetCacheSeconds: 300 });
    expect(cached['cache-control']).toBe('private, max-age=300');
    expect(cached['content-security-policy']).toBeUndefined();
    const htmlCached = contentHeaders({ mimeType: 'text/html', size: 7, assetCacheSeconds: 300 });
    expect(htmlCached['cache-control']).toBe('no-store');
  });

  it('builds a host-only grant cookie and parses it back', () => {
    const cookie = grantCookie('payload.signature', 55);
    expect(cookie).toContain(`${GRANT_COOKIE_NAME}=payload.signature`);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=55');
    expect(cookie).not.toContain('Domain=');
    expect(parseGrantCookie(cookie)).toBe('payload.signature');
    expect(parseGrantCookie('other=1; ' + cookie)).toBe('payload.signature');
    expect(parseGrantCookie('other=1')).toBeUndefined();
    expect(parseGrantCookie(undefined)).toBeUndefined();
  });
});

describe('reader api profile', () => {
  const read = {
    subjectId: 'steve', method: 'GET', route: '/api/notes',
    artifactId: ARTIFACT, releaseId: RELEASE,
  };

  it('allows exact profile reads with reader attribution', () => {
    expect(authorizeReaderApiCall(profile, read)).toEqual({
      allowed: true,
      attribution: { subjectId: 'steve', artifactId: ARTIFACT, releaseId: RELEASE },
    });
  });

  it('refuses off-profile subjects, routes, methods and release bindings', () => {
    expect(authorizeReaderApiCall(profile, { ...read, subjectId: 'mallory' }))
      .toEqual({ allowed: false, reason: 'profile' });
    expect(authorizeReaderApiCall(profile, { ...read, route: '/api/admin' }))
      .toEqual({ allowed: false, reason: 'profile' });
    expect(authorizeReaderApiCall(profile, { ...read, method: 'DELETE' }))
      .toEqual({ allowed: false, reason: 'profile' });
    expect(authorizeReaderApiCall(profile, { ...read, releaseId: 'other-release' }))
      .toEqual({ allowed: false, reason: 'profile' });
  });

  it('requires origin and CSRF header evidence for writes', () => {
    const write = { ...read, method: 'POST', expectedOrigin: ORIGIN };
    expect(authorizeReaderApiCall(profile, write)).toEqual({ allowed: false, reason: 'origin' });
    expect(authorizeReaderApiCall(profile, { ...write, origin: 'https://evil.test' }))
      .toEqual({ allowed: false, reason: 'origin' });
    expect(authorizeReaderApiCall(profile, { ...write, origin: ORIGIN }))
      .toEqual({ allowed: false, reason: 'csrf' });
    expect(authorizeReaderApiCall(profile, { ...write, origin: ORIGIN, hasCustomHeader: true }))
      .toMatchObject({ allowed: true });
    const unbound = { ...write, origin: ORIGIN, hasCustomHeader: true };
    delete (unbound as { expectedOrigin?: string }).expectedOrigin;
    expect(authorizeReaderApiCall(profile, unbound)).toEqual({ allowed: false, reason: 'origin' });
  });
});
