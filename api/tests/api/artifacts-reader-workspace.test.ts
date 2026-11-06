import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryReaderConsentStore } from '@sentropic/artifacts/server/reader-store';
import { requireAuth } from '../../src/middleware/auth';
import { createArtifactHttpRouter } from '../../src/routes/namespaces/artifacts';
import { createReaderConsentService } from '../../src/services/artifacts/reader-consent';
import { consentScreenPath } from '../../src/services/artifacts/reader-consent-screen';

const members = vi.hoisted(() => new Set<string>());
vi.mock('../../src/services/identity/cm-http-principal', () => ({
  authenticateCmHttpRequest: async () => ({ accepted: true, principal: {
    session: { userId: 'reader', sessionId: 'session' }, role: 'reader', user: {},
    sessionRecord: { createdAt: new Date('2026-11-06T00:00:00Z') },
  } }),
  publishCmAuthenticationRefusal: vi.fn(),
}));
vi.mock('../../src/services/workspace-service', () => ({
  ensureWorkspaceForUser: async () => ({ workspaceId: 'workspace-A' }),
}));
vi.mock('../../src/services/workspace-access', () => ({
  getWorkspaceRole: async (_reader: string, workspace: string) => members.has(workspace) ? 'reader' : null,
  isWorkspaceDeleted: async () => false,
}));

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'https://control.example.test';
const target = `artifactId=${ARTIFACT}&scopeId=reports.read`;

function fixture() {
  members.clear();
  members.add('workspace-A').add('workspace-B');
  const store = createMemoryReaderConsentStore();
  const services = Object.fromEntries(['workspace-A', 'workspace-B'].map(workspace => [workspace,
    createReaderConsentService({ store, storageScopeId: workspace,
      canReadArtifact: async artifact => workspace === 'workspace-B' && artifact === ARTIFACT,
      isAdmin: async () => false }),
  ]));
  const app = new Hono();
  app.use('*', requireAuth);
  app.route('/artifacts', createArtifactHttpRouter({
    identity: async context => ({ workspaceId: context.get('user').workspaceId,
      identity: { subject: 'reader', tenantId: 'tenant', clientId: 'session', credentialId: 'verified' } }),
    transport: async () => ({ http: async (_identity: unknown, workspace: string) =>
      ({ status: workspace === 'workspace-B' ? 200 : 404, body: {} }) }) as never,
    readerConsent: { enabled: () => true, controlOrigin: ORIGIN,
      declaredScopes: [{ scopeId: 'reports.read', scopeVersion: 'v1' }],
      consentScreen: { brand: 'Acme', title: 'Allow access' },
      service: async bound => services[bound.workspaceId] },
  }));
  const gate = (workspace = '') => app.request(`/artifacts/reader-gate?${target}${workspace ? `&workspace_id=${workspace}` : ''}`);
  const form = async () => {
    // Also exercise a caller that already preserved the selection on the URL.
    const screenUrl = new URL(`/artifacts/${consentScreenPath(ARTIFACT, 'reports.read', 'workspace-B')}`, ORIGIN);
    screenUrl.searchParams.set('workspace_id', 'workspace-B');
    const response = await app.request(screenUrl);
    expect(response.status).toBe(200);
    const html = await response.text();
    const action = new URL(html.match(/<form[^>]*action="([^"]+)"/)![1].replaceAll('&amp;', '&'), screenUrl);
    const body = new URLSearchParams([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)]
      .map(match => [match[1], match[2]]));
    return { action, body };
  };
  const submit = (action: URL, body: URLSearchParams) => app.request(action, { method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' }, body });
  return { gate, form, submit, services };
}

describe('authenticated workspace consent navigation', () => {
  it('should preserve and encode the selected workspace in the screen navigation', () => {
    const url = new URL(consentScreenPath(ARTIFACT, 'reports.read', 'workspace B&other=value'), `${ORIGIN}/`);
    expect(url.searchParams.get('workspace_id')).toBe('workspace B&other=value');
    expect(url.searchParams.has('other')).toBe(false);
  });

  it('should open the original gate after submitting the rendered form in the non-default workspace', async () => {
    const { gate, form, submit } = fixture();
    expect((await gate()).status).toBe(404);
    expect((await gate('workspace-B')).status).toBe(403);
    const { action, body } = await form();
    expect((await submit(action, body)).status).toBe(200);
    expect((await gate('workspace-B')).status).toBe(200);
    expect((await gate('workspace-B')).status).toBe(200);
    expect((await gate()).status).toBe(404);
  });

  it('should validate membership again for a tampered workspace or membership removed after rendering', async () => {
    const { gate, form, submit, services } = fixture();
    const { action, body } = await form();
    const tampered = new URL(action);
    tampered.searchParams.set('workspace_id', 'workspace-outsider');
    expect((await submit(tampered, body)).status).toBe(404);
    members.delete('workspace-B');
    expect((await submit(action, body)).status).toBe(404);
    expect(await services['workspace-B'].listOwnConsents('reader')).toEqual([]);
    members.add('workspace-B');
    expect((await gate('workspace-B')).status).toBe(403);
  });
});
