/**
 * J1.3b — generic grant contract on a fake non-immo tenant.
 *
 * A reader without consent gets the typed 403 `{ code, scopeId,
 * retryable: false }`, reaches the neutral host-parameterized screen in one
 * click through the single prescribed navigation, grants first-party, and the
 * gate opens with no loop. Scopes and versions are host-declared.
 */
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryReaderConsentStore } from '@sentropic/artifacts/server/reader-store';
import { createArtifactHttpRouter } from '../../src/routes/namespaces/artifacts';
import { createReaderConsentService } from '../../src/services/artifacts/reader-consent';
import { consentScreenPath } from '../../src/services/artifacts/reader-consent-screen';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const SCOPE = 'reports.read';
const VERSION = 'v1';
const CONTROL_ORIGIN = 'https://control.example.test';

function route(readable: boolean) {
  const declaration = { scopeId: SCOPE, scopeVersion: VERSION };
  const store = createMemoryReaderConsentStore();
  const service = createReaderConsentService({
    store,
    storageScopeId: 'fake-tenant-scope',
    canReadArtifact: async (artifactId) => readable && artifactId === ARTIFACT,
    isAdmin: async () => false,
    now: () => '2026-11-05T09:00:00.000Z',
  });
  const transport = { http: vi.fn(async (_identity: unknown, _workspace: string, req: { path: string }) =>
    req.path === `/meta/${ARTIFACT}` && readable
      ? { status: 200, body: {} }
      : { status: 404, body: { error: 'not_found' } }) };
  const app = new Hono();
  app.use('*', async (context, next) => {
    context.set('user', { userId: 'reader', role: 'reader' });
    await next();
  });
  app.route('/artifacts', createArtifactHttpRouter({
    transport: async () => transport as never,
    identity: async () => ({ workspaceId: 'workspace-fake',
      identity: { subject: 'reader', tenantId: 'fake-tenant', clientId: 'session', credentialId: 'verified' } }),
    readerConsent: {
      enabled: () => true,
      controlOrigin: CONTROL_ORIGIN,
      declaredScopes: [declaration],
      consentScreen: { brand: 'Acme', title: 'Allow access' },
      service: async () => service,
    },
  }));
  const gate = (query: string) => app.request(`/artifacts/reader-gate${query}`, { method: 'GET' });
  return { app, gate, declaration };
}

describe('generic grant contract on a fake tenant', () => {
  it('opens the gate in one click from the typed 403 with no loop', async () => {
    const { app, gate } = route(true);
    const refused = await gate(`?artifactId=${ARTIFACT}&scopeId=${SCOPE}`);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ code: 'reader_consent_required', scopeId: SCOPE, retryable: false });

    // Single prescribed navigation: the screen URL derives from the 403 fields.
    const screenResponse = await app.request(`/artifacts/${consentScreenPath(ARTIFACT, SCOPE)}`, { method: 'GET' });
    expect(screenResponse.status).toBe(200);
    const screen = await screenResponse.text();
    expect(screen).toContain('Acme');
    expect(screen).toContain(SCOPE);
    expect(screen.match(/<form /g)?.length).toBe(1);
    expect(screen).not.toContain('Radar');
    expect(screen).toContain(`name="scopeVersion" value="${VERSION}"`);

    const grant = await app.request('/artifacts/reader-consents/grant', { method: 'POST',
      headers: { 'content-type': 'application/json', origin: CONTROL_ORIGIN },
      body: JSON.stringify({ artifactId: ARTIFACT, scopeId: SCOPE, scopeVersion: VERSION }) });
    expect(grant.status).toBe(200);
    expect(await grant.json()).toMatchObject({ granted: true, artifactId: ARTIFACT, scopeId: SCOPE, scopeVersion: VERSION });

    const open = await gate(`?artifactId=${ARTIFACT}&scopeId=${SCOPE}`);
    expect(open.status).toBe(200);
    expect(await open.json()).toMatchObject({ allowed: true });
    const again = await gate(`?artifactId=${ARTIFACT}&scopeId=${SCOPE}`);
    expect(again.status).toBe(200);
  });

  it('refuses unknown scopes and cross-origin grants fail-closed', async () => {
    const { app, gate } = route(true);
    expect((await gate(`?artifactId=${ARTIFACT}&scopeId=nope`)).status).toBe(404);
    const cross = await app.request('/artifacts/reader-consents/grant', { method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.test' },
      body: JSON.stringify({ artifactId: ARTIFACT, scopeId: SCOPE }) });
    expect(cross.status).toBe(404);
    const still = await gate(`?artifactId=${ARTIFACT}&scopeId=${SCOPE}`);
    expect(still.status).toBe(403);
  });

  it('never oracles an unreadable artifact', async () => {
    const { gate } = route(false);
    expect((await gate(`?artifactId=${ARTIFACT}&scopeId=${SCOPE}`)).status).toBe(404);
  });

  it('should refuse a stale displayed version without granting the widened scope', async () => {
    const { app, gate, declaration } = route(true);
    const screen = await (await app.request(`/artifacts/${consentScreenPath(ARTIFACT, SCOPE)}`)).text();
    expect(screen).toContain(VERSION);
    declaration.scopeVersion = 'v2';
    const grant = await app.request('/artifacts/reader-consents/grant', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: CONTROL_ORIGIN },
      body: new URLSearchParams({ artifactId: ARTIFACT, scopeId: SCOPE, scopeVersion: VERSION }) });
    expect(grant.status).toBe(400);
    expect((await gate(`?artifactId=${ARTIFACT}&scopeId=${SCOPE}`)).status).toBe(403);
  });

  it('should require the accepted scope version and accept a current form submission', async () => {
    const { app } = route(true);
    const submit = (scopeVersion?: string) => app.request('/artifacts/reader-consents/grant', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: CONTROL_ORIGIN },
      body: new URLSearchParams({ artifactId: ARTIFACT, scopeId: SCOPE, ...(scopeVersion === undefined ? {} : { scopeVersion }) }) });
    expect((await submit()).status).toBe(400);
    const grant = await submit(VERSION);
    expect(grant.status).toBe(200);
    expect(await grant.json()).toMatchObject({ granted: true, scopeVersion: VERSION });
  });
});
