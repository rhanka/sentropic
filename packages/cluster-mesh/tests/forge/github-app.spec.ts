import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fixture, key, owner, permissions } from './fake-github.js';

describe('GitHub App enrollment', () => {
  it('should enroll through manifest and install callbacks without exporting custody material', async () => {
    const f = fixture();
    const entry = await f.ready();
    const status = await f.service.status(owner, entry.installationRef);
    expect(status.state).toBe('ready');
    expect(JSON.stringify(status)).not.toMatch(/fake-webhook|privateKey|installationId|fake-token/);
    expect(JSON.stringify([...f.envelopes.values()])).not.toContain(f.appKey);
    expect(JSON.stringify([...f.envelopes.values()])).not.toContain('fake-webhook');
    const lease = await f.service.acquire({ ...owner, installationRef: entry.installationRef });
    expect(lease).toMatchObject({ repositoryId: '101', permissions });
    expect(f.minted.at(-1)).toEqual({ repositoryId: '101', permissions });
  });

  it('should refuse replayed, expired and cross-scope owner callbacks before exchange', async () => {
    const f = fixture();
    const entry = await f.service.begin(owner);
    const prompt = await f.service.prompt(owner, entry.installationRef);
    const callback = { state: prompt.state, code: 'fake-code' };
    await expect(f.service.convert({ ...owner, storageScopeId: 'other' }, entry.installationRef, callback))
      .rejects.toThrow('access_denied');
    await f.service.convert(owner, entry.installationRef, callback);
    await expect(f.service.convert(owner, entry.installationRef, callback)).rejects.toThrow('access_denied');
    const next = await f.service.begin(owner);
    const expired = await f.service.prompt(owner, next.installationRef);
    f.advance(600001);
    await expect(f.service.convert(owner, next.installationRef, { ...callback, state: expired.state }))
      .rejects.toThrow('access_denied');
  });

  it('should refuse a lease for another scope, repo or reference', async () => {
    const f = fixture();
    const entry = await f.ready();
    for (const change of [{ repoId: 'other' }, { storageScopeId: 'other' }]) {
      await expect(f.service.acquire({ ...owner, ...entry, ...change })).rejects.toThrow('access_denied');
    }
    await expect(f.service.acquire({ ...owner, installationRef: 'missing' })).rejects.toThrow('capability_unavailable');
  });

  it.each(['workflows', 'administration', 'actions'])('should reject granted %s permission before activating', async (permission) => {
    const f = fixture();
    f.grant({ ...permissions, [permission]: 'write' });
    await expect(f.ready()).rejects.toThrow('capability_unavailable');
    expect(f.minted).toHaveLength(0);
  });

  it('should reject overbroad tokens and revoke them before returning a lease', async () => {
    const f = fixture();
    const entry = await f.ready();
    f.tokenRepos(['101', '202']);
    await expect(f.service.acquire({ ...owner, ...entry })).rejects.toThrow('capability_unavailable');
    expect(f.revoked.length).toBeGreaterThan(0);
  });

  it('should mint independent tokens for repos sharing the same installation', async () => {
    const f = fixture();
    const first = await f.ready();
    const other = { ...owner, storageScopeId: 'sentropic', repoId: 'repo-sentropic', locator: 'rhanka/sentropic' };
    f.tokenRepos(['202']);
    const second = await f.ready(other);
    expect(second.installationRef).not.toBe(first.installationRef);
    const lease = await f.service.acquire({ ...other, ...second });
    expect(lease.repositoryId).toBe('202');
    f.tokenRepos(['101']);
    expect((await f.service.acquire({ ...owner, ...first })).repositoryId).toBe('101');
    await expect(f.service.acquire({ ...other, installationRef: first.installationRef })).rejects.toThrow('access_denied');
  });

  it('should rotate App keys with verification, epoch fencing and revocation', async () => {
    const f = fixture();
    const entry = await f.ready();
    const before = await f.service.acquire({ ...owner, ...entry });
    await f.service.rotateAppKey(owner, entry.installationRef, key());
    const after = await f.service.acquire({ ...owner, ...entry });
    expect(after.credentialVersion).not.toBe(before.credentialVersion);
    expect(f.revoked).toContain(before.token);
    expect(JSON.stringify(await f.service.status(owner, entry.installationRef))).not.toContain('PRIVATE KEY');
  });

  it('should accept webhook overlap only inside the recorded rotation window', async () => {
    const f = fixture();
    const entry = await f.ready();
    const rawBody = Buffer.from('{"action":"test"}');
    const verify = (secret: string) => f.service.verify({ ...owner, ...entry, rawBody, deliveryId: 'delivery',
      signature: `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}` });
    expect((await verify('fake-webhook')).valid).toBe(true);
    await f.service.rotateWebhook(owner, entry.installationRef, 'fake-next-webhook', 60000);
    expect((await verify('fake-webhook')).valid).toBe(true);
    expect((await verify('fake-next-webhook')).valid).toBe(true);
    f.advance(60001);
    expect((await verify('fake-webhook')).valid).toBe(false);
    expect((await verify('fake-next-webhook')).valid).toBe(true);
    await expect(f.service.rotateWebhook(owner, entry.installationRef, 'x', Infinity)).rejects.toThrow('invalid_request');
  });

  it.each(['suspended', 'uninstalled', 'repository_removed', 'permissions_lost'] as const)
  ('should revoke leases and refuse new minting after %s', async (reason) => {
    const f = fixture();
    const entry = await f.ready();
    const lease = await f.service.acquire({ ...owner, ...entry });
    await f.service.revoke(owner, entry.installationRef, reason);
    expect(f.revoked).toContain(lease.token);
    await expect(f.service.acquire({ ...owner, ...entry })).rejects.toThrow('capability_unavailable');
    expect((await f.service.status(owner, entry.installationRef)).state).toBe('revoked');
  });

  it('should close minting when installation access disappears at the forge', async () => {
    const f = fixture();
    const entry = await f.ready();
    f.remove();
    await expect(f.service.acquire({ ...owner, ...entry })).rejects.toThrow('capability_unavailable');
    expect((await f.service.status(owner, entry.installationRef)).state).toBe('revoked');
  });
});
