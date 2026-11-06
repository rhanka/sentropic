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
});
