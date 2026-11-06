import { describe, expect, it } from 'vitest';
import { createGitHubAppRouter } from '../../src/forge/hono.js';
import { fixture, owner } from './fake-github.js';

describe('GitHub App host routes', () => {
  it('should present the manifest form only to the authenticated repository owner', async () => {
    const f = fixture();
    const entry = await f.service.begin(owner);
    const app = createGitHubAppRouter({ service: f.service, publicBaseUrl: 'https://mesh.example',
      resolveOwner: async (request) => request.headers.get('x-test-owner') === 'yes' ? owner : null,
      authenticateBroker: async () => null });
    const response = await app.request(`/github-app/${entry.installationRef}`, { headers: { 'x-test-owner': 'yes' } });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('https://github.com/settings/apps/new');
    expect(html).toContain('Enroll rhanka/radar-immobilier');
    expect(html).not.toContain('PRIVATE KEY');
    expect((await app.request(`/github-app/${entry.installationRef}`)).status).toBe(403);
  });

  it('should authenticate the broker and reject tuple substitution and permission overrides', async () => {
    const f = fixture();
    const entry = await f.ready();
    const app = createGitHubAppRouter({ service: f.service, publicBaseUrl: 'https://mesh.example',
      resolveOwner: async () => owner,
      authenticateBroker: async (request) => request.headers.get('x-test-service') === 'yes' ? owner : null });
    const tuple = { storageScopeId: owner.storageScopeId, repoId: owner.repoId, installationRef: entry.installationRef };
    const request = (body: unknown, authenticated = true) => app.request('/github-app/broker/lease', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { 'x-test-service': 'yes' } : {}) },
      body: JSON.stringify(body) });
    expect((await request(tuple, false)).status).toBe(403);
    expect((await request({ ...tuple, storageScopeId: 'other' })).status).toBe(403);
    expect((await request({ ...tuple, permissions: { workflows: 'write' } })).status).toBe(400);
    const response = await request(tuple);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
