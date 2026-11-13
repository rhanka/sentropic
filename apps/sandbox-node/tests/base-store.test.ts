import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ensureBase } from '../src/base-store.js';
import { sha256Hex } from '../src/tickets.js';

describe('immutable base import', () => {
  it('should reject other regions, tenants and ambiguous paths before fetching', async () => {
    const fetchBase = vi.fn(async () => new Response('bytes'));
    const root = mkdtempSync(join(tmpdir(), 'url-policy-'));
    const base = { tenantId: 'immo' as const, baseId: 'b', kind: 'rootfs' as const, identityDigest: '0'.repeat(64) };
    for (const url of ['https://evil.example/bucket/tenants/immo/base',
      'https://s3.gra.io.cloud.ovh.net/bucket/tenants/immo/base',
      'https://s3.bhs.io.cloud.ovh.net/bucket/tenants/sentropic/base',
      'https://s3.bhs.io.cloud.ovh.net/bucket/tenants/immo%2fbase',
      'https://s3.bhs.io.cloud.ovh.net/bucket/tenants/immo/../sentropic/base']) {
      await expect(ensureBase(base, url, { root, fetchBase })).rejects.toThrow();
    }
    rmSync(root, { recursive: true });
    expect(fetchBase).not.toHaveBeenCalled();
  });
  it('should reject a different bucket or environment before touching the network', async () => {
    const fetchBase = vi.fn(async () => new Response('bytes'));
    const base = { tenantId: 'immo' as const, baseId: 'b', kind: 'source' as const, identityDigest: '0'.repeat(64) };
    for (const url of ['https://other.s3.bhs.io.cloud.ovh.net/tenants/immo/preprod/base',
      'https://s3.bhs.io.cloud.ovh.net/other/tenants/immo/preprod/base',
      'https://sentropic-execution-bhs.s3.bhs.io.cloud.ovh.net/tenants/immo/prod/base']) {
      await expect(ensureBase(base, url, { fetchBase })).rejects.toThrow(/BHS/);
    }
    expect(fetchBase).not.toHaveBeenCalled();
  });
  it('should publish only digest-verified bases and reject corrupt or unsafe imports', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'base-'));
    const bytes = Buffer.from('erofs fixture');
    const fetchBase = async () => new Response(bytes);
    const base = { tenantId: 'immo' as const, baseId: 'root', kind: 'rootfs' as const, identityDigest: sha256Hex(bytes) };
    try {
      const path = await ensureBase(base, 'https://s3.bhs.io.cloud.ovh.net/sentropic-execution-bhs/tenants/immo/preprod/base', { root: dir, fetchBase });
      expect(readFileSync(path)).toEqual(bytes);
      await expect(ensureBase({ ...base, identityDigest: '0'.repeat(64) }, 'https://s3.bhs.io.cloud.ovh.net/sentropic-execution-bhs/tenants/immo/preprod/base', { root: dir, fetchBase })).rejects.toThrow(/digest/);
      await expect(ensureBase(base, 'http://s3.example/base', { root: dir, fetchBase })).rejects.toThrow();
      await expect(ensureBase({ ...base, baseId: '../other' }, 'https://s3.example/base', { root: dir, fetchBase })).rejects.toThrow();
    } finally { rmSync(dir, { recursive: true }); }
  });
});
