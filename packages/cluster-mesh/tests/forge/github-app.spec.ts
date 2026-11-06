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
    await f.service.switchWebhookSender(owner, entry.installationRef);
    expect((await verify('fake-webhook')).valid).toBe(true);
    expect((await verify('fake-next-webhook')).valid).toBe(true);
    f.advance(60001);
    await f.service.retirePreviousWebhook(owner, entry.installationRef);
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
    expect(f.invalidations.at(-1)?.repoId).toBe(owner.repoId);
    expect(f.invalidations.at(-1)?.credentialVersion).not.toBe(lease.credentialVersion);
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

  it.each(['deleted', 'suspend', 'removed'])('should fence tokens on a verified %s webhook', async (action) => {
    const f = fixture();
    const entry = await f.ready();
    const lease = await f.service.acquire({ ...owner, ...entry });
    const rawBody = Buffer.from(JSON.stringify({ action, installation: { id: 500 }, repositories_removed: [{ id: 101 }] }));
    const signature = `sha256=${createHmac('sha256', 'fake-webhook').update(rawBody).digest('hex')}`;
    await expect(f.service.installationEvent(entry.installationRef, rawBody, 'sha256=bad', 'installation'))
      .rejects.toThrow('access_denied');
    await f.service.installationEvent(entry.installationRef, rawBody, signature,
      action === 'removed' ? 'installation_repositories' : 'installation');
    expect(f.revoked).toContain(lease.token);
    expect((await f.service.status(owner, entry.installationRef)).state).toBe('revoked');
  });

  it('should reject tampered ciphertext and record substitution', async () => {
    const f = fixture();
    const first = await f.ready();
    const second = await f.ready();
    f.envelopes.set(second.installationRef, f.envelopes.get(first.installationRef)!);
    await expect(f.service.status(owner, second.installationRef)).rejects.toThrow('capability_unavailable');
    f.envelopes.set(first.installationRef, '{"v":1,"ciphertext":"tampered"}');
    await expect(f.service.status(owner, first.installationRef)).rejects.toThrow('capability_unavailable');
  });

  it('should consume an installation callback only once under concurrency', async () => {
    const f = fixture();
    const entry = await f.service.begin(owner);
    const prompt = await f.service.prompt(owner, entry.installationRef);
    const converted = await f.service.convert(owner, entry.installationRef, { state: prompt.state, code: 'fake-code' });
    const callback = { state: new URL(converted.installationUrl).searchParams.get('state')!, installationId: '500' };
    const results = await Promise.allSettled([f.service.install(owner, entry.installationRef, callback),
      f.service.install(owner, entry.installationRef, callback)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('should refuse retiring the previous secret before the window closes or the sender switches', async () => {
    const f = fixture();
    const entry = await f.ready();
    await f.service.rotateWebhook(owner, entry.installationRef, 'fake-next', 60000);
    await expect(f.service.retirePreviousWebhook(owner, entry.installationRef)).rejects.toThrow('invalid_request');
    await f.service.switchWebhookSender(owner, entry.installationRef);
    f.advance(60001);
    await f.service.retirePreviousWebhook(owner, entry.installationRef);
    expect((await f.service.status(owner, entry.installationRef)).webhookOverlapEndsAt).toBeNull();
  });
});
