import { describe, expect, it } from 'vitest';
import { createDossierAccess, createStaticMembership, listReadable, ACCESS_REFUSED_HTML } from '../../src/gas/access.js';
import { createSyncBoundaryDomain } from '../../src/gas/boundary.js';
import { createGasDigest } from '../../src/gas/digest.js';
import { createGasViewerIdentity } from '../../src/gas/identity.js';
import { mockUtilities } from './harness.js';

const session = (email: string | (() => string)) => ({ getActiveUser: () => ({ getEmail: typeof email === 'function' ? email : () => email }) });
function setup(email: string | (() => string), domains: string[] = ['airbus.com'], tenantDomains: string[] = domains) {
  const events: Record<string, unknown>[] = [];
  const stores: string[] = [];
  const boundary = createSyncBoundaryDomain({ homeNodeId: 'node:gas', digest: createGasDigest(mockUtilities()), memberships: createStaticMembership({ tenantId: 'airbus', domains: tenantDomains }) });
  const access = createDossierAccess({ identity: createGasViewerIdentity({ session: session(email), allowedDomains: domains }), boundary, log: { log: (e) => void events.push(e) }, clock: () => new Date('2026-11-07T00:00:00Z') });
  const lookup = () => (stores.push('lookup'), { artifactId: 'demo', version: 1, payloadSha256: 'a'.repeat(64) });
  return { events, stores, access, lookup };
}

describe('A3 identity refusals touch no store', () => {
  for (const [name, email, domains] of [
    ['empty email', '', ['airbus.com']],
    ['bad domain', 'u@evil.com', ['airbus.com']],
    ['two @', 'a@b@airbus.com', ['airbus.com']],
    ['no @', 'airbus.com', ['airbus.com']],
    ['empty allowed list', 'u@airbus.com', []],
  ] as const) {
    it(name, () => {
      const t = setup(email, [...domains]);
      const r = t.access.serve({ parameter: {} }, t.lookup);
      expect(r).toMatchObject({ kind: 'refused', html: ACCESS_REFUSED_HTML });
      expect(t.stores).toEqual([]);
      expect(t.events.map((e) => e.event)).toEqual(['dossier.denied']);
    });
  }
  it('Session.getActiveUser throwing is refused with no subject logged', () => {
    const t = setup(() => { throw new Error('no session'); });
    expect(t.access.serve(null, t.lookup)).toMatchObject({ kind: 'refused', reason: 'no_identity' });
    expect(t.stores).toEqual([]);
    expect(t.events[0]).not.toHaveProperty('subject');
  });
  it('denied logs the subject only when an email was read', () => {
    const t = setup('u@evil.com');
    t.access.serve(null, t.lookup);
    expect(t.events[0]).toMatchObject({ event: 'dossier.denied', subject: 'u@evil.com' });
  });
});

describe('A3 success and tenant', () => {
  it('valid email gives exactly one dossier.view with issuer/subject and ignores ?tenant=', () => {
    const t = setup('User@Airbus.com');
    const r = t.access.serve({ parameter: { tenant: 'other', t: 'other' } }, t.lookup);
    expect(r).toMatchObject({ kind: 'view', identity: { issuer: 'google-workspace:airbus.com', subject: 'user@airbus.com' }, context: { tid: 'airbus' } });
    expect(t.events).toEqual([{ event: 'dossier.view', issuer: 'google-workspace:airbus.com', subject: 'user@airbus.com', tid: 'airbus', artifactId: 'demo', version: 1, payloadSha256: 'a'.repeat(64), outcome: 'ok', ts: '2026-11-07T00:00:00.000Z' }]);
  });
  it('TenantBoundaryError (membership miss) renders the refusal page and skips lookup', () => {
    const t = setup('u@airbus.com', ['airbus.com'], ['other.com']);
    expect(t.access.serve(null, t.lookup)).toMatchObject({ kind: 'refused', reason: 'tenant_membership_required' });
    expect(t.stores).toEqual([]);
  });
  it('audit log failure fails the read closed', () => {
    const t = setup('u@airbus.com');
    const access = createDossierAccess({ identity: createGasViewerIdentity({ session: session('u@airbus.com'), allowedDomains: ['airbus.com'] }), boundary: createSyncBoundaryDomain({ homeNodeId: 'node:gas', digest: createGasDigest(mockUtilities()), memberships: createStaticMembership({ tenantId: 'airbus', domains: ['airbus.com'] }) }), log: { log: () => { throw new Error('log down'); } }, clock: () => new Date(0) });
    expect(access.serve(null, t.lookup)).toMatchObject({ kind: 'refused', reason: 'audit_unavailable' });
  });
  it('index lists only tenant-readable dossiers (two-tenant fixture)', () => {
    const entries = [{ id: 'a', tenantId: 'airbus' }, { id: 'b', tenantId: 'other' }, { id: 'c', tenantId: 'airbus' }];
    const ctx = { tid: 'airbus', workspace: 'ws:sha256:x', userId: 'u', homeNodeId: 'node:gas' } as const;
    expect(listReadable(ctx as any, entries).map((e) => e.id)).toEqual(['a', 'c']);
  });
});
