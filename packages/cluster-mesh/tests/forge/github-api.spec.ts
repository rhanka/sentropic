import { describe, expect, it } from 'vitest';
import { createGitHubAppApi } from '../../src/forge/github-api.js';
import { key, permissions } from './fake-github.js';

describe('GitHub REST adapter', () => {
  it('should exchange the manifest server-side and scope token creation to one repository', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const privateKey = key();
    const api = createGitHubAppApi({ fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/conversions')) return Response.json({ id: 42, slug: 'test-app', pem: privateKey, webhook_secret: 'fake-secret' });
      if (String(url).endsWith('/access_tokens')) return Response.json({ token: 'fake-token', expires_at: '2026-11-05T13:00:00Z', permissions });
      return Response.json({ total_count: 1, repositories: [{ id: 101, full_name: 'rhanka/radar-immobilier' }] });
    } });
    const app = await api.exchange('fake-code');
    const token = await api.mint(app, '500', '101', permissions);
    expect(token.repositoryIds).toEqual(['101']);
    const mint = calls.find((call) => call.url.endsWith('/access_tokens'))!;
    expect(JSON.parse(String(mint.init?.body))).toEqual({ repository_ids: [101], permissions });
    expect(calls.every((call) => call.url.startsWith('https://api.github.com/'))).toBe(true);
    expect(calls.every((call) => call.init?.redirect === 'error')).toBe(true);
  });

  it('should verify the new signing key against the enrolled App identity', async () => {
    const api = createGitHubAppApi({ fetch: async () => Response.json({ id: 999 }) });
    await expect(api.verifyKey({ appId: '42', slug: 'test-app', privateKey: key(), webhookSecret: 'fake' }))
      .rejects.toThrow('capability_unavailable');
  });

  it('should suppress provider response bodies and transport errors', async () => {
    for (const fetch of [async () => new Response('fake-sensitive-provider-body', { status: 500 }),
      async () => { throw new Error('fake-sensitive-transport-error'); }]) {
      const api = createGitHubAppApi({ fetch });
      await expect(api.exchange('fake-code')).rejects.toThrow(/^capability_unavailable$/);
    }
  });
});
