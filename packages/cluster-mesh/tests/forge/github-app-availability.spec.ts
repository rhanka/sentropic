import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createGitHubAppApi } from '../../src/forge/github-api.js';
import { fixture, owner } from './fake-github.js';

const failures = [
  ['server error', () => new Response(null, { status: 503 })],
  ['rate limit', () => new Response(null, { status: 429 })],
  ['primary rate limit', () => Response.json({ message: 'API rate limit exceeded' },
    { status: 403, headers: { 'x-ratelimit-remaining': '0' } })],
  ['secondary rate limit', () => Response.json({ message: 'You have exceeded a secondary rate limit.' }, { status: 403 })],
  ['transport error', () => { throw new Error('synthetic transport failure'); }],
] as const;
const delivery = () => {
  const rawBody = Buffer.from(JSON.stringify({ action: 'new_permissions_accepted', installation: { id: 500 } }));
  return { rawBody, signature: `sha256=${createHmac('sha256', 'fake-webhook').update(rawBody).digest('hex')}` };
};

describe('recoverable GitHub availability', () => {
  for (const operation of ['inspectInstallation', 'mint'] as const) {
    it.each(failures)(`should recover ${operation} after a %s without reenrollment`, async (_name, fail) => {
      const f = fixture();
      const entry = await f.ready();
      const lease = await f.service.acquire({ ...owner, ...entry });
      const healthy = f.github[operation];
      const api = createGitHubAppApi({ fetch: async () => fail() });
      if (operation === 'mint') f.github.mint = api.mint;
      else f.github.inspectInstallation = api.inspectInstallation;
      await expect(f.service.acquire({ ...owner, ...entry })).rejects.toThrow(/^capability_unavailable$/);
      expect((await f.service.status(owner, entry.installationRef)).state).toBe('unavailable');
      expect(f.invalidations).toEqual([]);
      expect(f.revoked).toEqual([]);
      Object.assign(f.github, { [operation]: healthy });
      const recovered = await f.service.acquire({ ...owner, ...entry });
      expect(recovered.credentialVersion).toBe(lease.credentialVersion);
      expect(recovered.token).not.toBe(lease.token);
      expect((await f.service.status(owner, entry.installationRef)).state).toBe('ready');
      expect((await f.service.verify({ ...owner, ...entry, ...delivery(), deliveryId: 'recovered' })).valid).toBe(true);
    });
  }

  it('should retry a permission-change inspection after a transient webhook failure', async () => {
    const f = fixture();
    const entry = await f.ready();
    const healthy = f.github.inspectInstallation;
    f.github.inspectInstallation = createGitHubAppApi({ fetch: async () => new Response(null, { status: 503 }) }).inspectInstallation;
    const { rawBody, signature } = delivery();
    await expect(f.service.installationEvent(entry.installationRef, rawBody, signature, 'installation'))
      .rejects.toThrow('capability_unavailable');
    expect((await f.service.status(owner, entry.installationRef)).state).toBe('unavailable');
    expect(f.invalidations).toEqual([]);
    f.github.inspectInstallation = healthy;
    await f.service.installationEvent(entry.installationRef, rawBody, signature, 'installation');
    expect((await f.service.status(owner, entry.installationRef)).state).toBe('ready');
  });

  it.each([401, 404, 403])('should fence leases permanently after authoritative HTTP %s', async (status) => {
    const f = fixture();
    const entry = await f.ready();
    const lease = await f.service.acquire({ ...owner, ...entry });
    const healthy = f.github.inspectInstallation;
    f.github.inspectInstallation = createGitHubAppApi({ fetch: async () =>
      Response.json({ message: 'Resource not accessible by integration' }, { status }) }).inspectInstallation;
    await expect(f.service.acquire({ ...owner, ...entry })).rejects.toThrow('capability_unavailable');
    expect((await f.service.status(owner, entry.installationRef)).state).toBe('revoked');
    expect(f.revoked).toContain(lease.token);
    expect(f.invalidations.at(-1)?.credentialVersion).toBe(lease.credentialVersion);
    f.github.inspectInstallation = healthy;
    await expect(f.service.acquire({ ...owner, ...entry })).rejects.toThrow('capability_unavailable');
  });
});
