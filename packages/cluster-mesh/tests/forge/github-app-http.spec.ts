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

  it('should post a manifest GitHub accepts: no default installation events, webhook URL kept', async () => {
    const f = fixture();
    const entry = await f.service.begin(owner);
    const app = createGitHubAppRouter({ service: f.service, publicBaseUrl: 'https://mesh.example',
      resolveOwner: async () => owner, authenticateBroker: async () => null });
    const html = await (await app.request(`/github-app/${entry.installationRef}`)).text();
    const encoded = /name="manifest" value="([^"]*)"/.exec(html)?.[1] ?? '';
    const manifest = JSON.parse(encoded.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    // GitHub delivers these to every App webhook and rejects a manifest listing them.
    const events: unknown[] = manifest.default_events ?? [];
    expect(events).not.toContain('installation');
    expect(events).not.toContain('installation_repositories');
    expect(manifest.hook_attributes).toEqual({
      url: `https://mesh.example/github-app/${entry.installationRef}/events`, active: true });
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

  it('should enforce same-origin owner mutations and never echo callback credentials', async () => {
    const f = fixture();
    const entry = await f.service.begin(owner);
    const prompt = await f.service.prompt(owner, entry.installationRef);
    const app = createGitHubAppRouter({ service: f.service, publicBaseUrl: 'https://mesh.example',
      resolveOwner: async () => owner, authenticateBroker: async () => null });
    expect((await app.request('/github-app/enroll', { method: 'POST' })).status).toBe(403);
    const response = await app.request(`/github-app/${entry.installationRef}/manifest?state=${prompt.state}&code=fake-code`);
    expect(response.status).toBe(303);
    expect(await response.text()).not.toContain('fake-code');
    expect(response.headers.get('location')).not.toContain('fake-code');
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
  });

  it('should accept an enroll POST only from the exact public origin, never from "null" or a foreign origin', async () => {
    const f = fixture();
    const app = createGitHubAppRouter({ service: f.service, publicBaseUrl: 'https://mesh.example/',
      resolveOwner: async () => owner, authenticateBroker: async () => null });
    const post = (origin: string) => app.request('/github-app/enroll', { method: 'POST', headers: { origin } });
    const accepted = await post('https://mesh.example');
    expect(accepted.status).toBe(303);
    expect(accepted.headers.get('referrer-policy')).toBe('same-origin');
    for (const origin of ['null', 'https://evil.example', 'http://mesh.example', 'https://mesh.example:8443']) {
      const refused = await post(origin);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: 'access_denied' });
    }
  });

  it('should let a browser submit the router forms with the Origin the served referrer policy yields', async () => {
    const f = fixture();
    const entry = await f.ready();
    const app = createGitHubAppRouter({ service: f.service, publicBaseUrl: 'https://mesh.example',
      resolveOwner: async () => owner, authenticateBroker: async () => null });
    const submit = async (pagePath: string, pick: (actions: string[]) => string) => {
      const page = await app.request(`https://mesh.example${pagePath}`);
      expect(page.status).toBe(200);
      const action = pick([...(await page.text()).matchAll(/<form method="post" action="([^"]+)"/g)].map((m) => m[1]!));
      const origin = browserFormOrigin(page.headers.get('referrer-policy'), `https://mesh.example${pagePath}`, action);
      return { action, origin, response: () => app.request(new URL(action, 'https://mesh.example').href,
        { method: 'POST', headers: { origin } }) };
    };
    const enroll = await submit('/github-app', (actions) => actions[0]!);
    expect(enroll.origin).toBe('https://mesh.example');
    expect((await enroll.response()).status).toBe(303);
    const stage = await submit(`/github-app/${entry.installationRef}/rotation`,
      (actions) => actions.find((action) => action.endsWith('/webhook-stage'))!);
    expect(stage.origin).toBe('https://mesh.example');
    expect((await stage.response()).status).toBe(200);
    // The manifest form posts cross-origin to github.com: no Origin, no referrer.
    const pending = await f.service.begin(owner);
    const manifest = await submit(`/github-app/${pending.installationRef}`, (actions) => actions[0]!);
    expect(new URL(manifest.action).origin).toBe('https://github.com');
    expect(manifest.origin).toBe('null');
    // Under the former no-referrer policy the same same-origin form failed csrf().
    expect(browserFormOrigin('no-referrer', 'https://mesh.example/github-app', '/github-app/enroll')).toBe('null');
  });

  it('should resume a lost installation redirect with a fresh one-time state only for the owner', async () => {
    const f = fixture();
    const entry = await f.service.begin(owner);
    const ref = entry.installationRef;
    const manifestPrompt = await f.service.prompt(owner, ref);
    expect(manifestPrompt.phase).toBe('manifest');
    const converted = await f.service.convert(owner, ref, { state: manifestPrompt.state, code: 'fake-code' });
    const lost = new URL(converted.installationUrl).searchParams.get('state')!;
    // The convert response never reached the browser and its state expired.
    f.advance(600001);
    const app = createGitHubAppRouter({ service: f.service, publicBaseUrl: 'https://mesh.example',
      resolveOwner: async (request) => request.headers.get('x-test-owner') === 'yes' ? owner : null,
      authenticateBroker: async () => null });
    const headers = { 'x-test-owner': 'yes' };
    expect((await app.request(`/github-app/${ref}`)).status).toBe(403);
    await expect(f.service.prompt({ ...owner, ownerId: 'other' }, ref)).rejects.toThrow('access_denied');
    const page = await app.request(`/github-app/${ref}`, { headers });
    expect(page.status).toBe(200);
    const href = /<a href="([^"]+)"/.exec(await page.text())?.[1]?.replace(/&amp;/g, '&') ?? '';
    const resumed = new URL(href);
    expect(`${resumed.origin}${resumed.pathname}`).toBe('https://github.com/apps/test-app/installations/new');
    const fresh = resumed.searchParams.get('state')!;
    expect(fresh).toMatch(/^[0-9a-f-]{36}$/);
    expect(fresh).not.toBe(lost);
    const install = (state: string) =>
      app.request(`/github-app/${ref}/installation?installation_id=500&state=${state}`, { headers });
    expect((await install('')).status).toBe(403);
    expect((await install(lost)).status).toBe(403);
    const accepted = await install(fresh);
    expect(accepted.status).toBe(303);
    expect(accepted.headers.get('location')).toBe(`/github-app/${ref}/status`);
    expect((await install(fresh)).status).toBe(403);
    expect((await f.service.status(owner, ref)).state).toBe('ready');
    expect((await app.request(`/github-app/${ref}`, { headers })).status).toBe(503);
  });

  it('should refuse the previous resume state once a newer prompt overwrote it', async () => {
    const f = fixture();
    const entry = await f.service.begin(owner);
    const ref = entry.installationRef;
    const manifestPrompt = await f.service.prompt(owner, ref);
    await f.service.convert(owner, ref, { state: manifestPrompt.state, code: 'fake-code' });
    const first = await f.service.prompt(owner, ref);
    const second = await f.service.prompt(owner, ref);
    expect(first.phase).toBe('install');
    expect(second.state).not.toBe(first.state);
    await expect(f.service.install(owner, ref, { state: first.state, installationId: '500' })).rejects.toThrow('access_denied');
    f.advance(600001);
    await expect(f.service.install(owner, ref, { state: second.state, installationId: '500' })).rejects.toThrow('access_denied');
    const third = await f.service.prompt(owner, ref);
    await expect(f.service.install({ ...owner, storageScopeId: 'other' }, ref, { state: third.state, installationId: '500' }))
      .rejects.toThrow('access_denied');
    expect((await f.service.install(owner, ref, { state: third.state, installationId: '500' })).state).toBe('ready');
  });
});

/**
 * Fetch "append a request Origin header" for a non-CORS POST (an HTML form
 * submission): the Origin a browser sends from a page served under `policy`.
 */
const browserFormOrigin = (policy: string | null, pageUrl: string, actionUrl: string): string => {
  const page = new URL(pageUrl);
  const action = new URL(actionUrl, page);
  switch (policy?.split(',').map((token) => token.trim()).filter(Boolean).at(-1) ?? '') {
    case 'no-referrer':
      return 'null';
    case 'same-origin':
      return action.origin === page.origin ? page.origin : 'null';
    case 'origin':
    case 'origin-when-cross-origin':
    case 'unsafe-url':
      return page.origin;
    default: // no-referrer-when-downgrade, strict-origin, strict-origin-when-cross-origin (the default)
      return page.protocol === 'https:' && action.protocol !== 'https:' ? 'null' : page.origin;
  }
};
