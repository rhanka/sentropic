import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureBase } from '../src/base-store.js';
import { sha256Hex } from '../src/tickets.js';

describe('immutable base import', () => {
  it('should publish only digest-verified bases and reject corrupt or unsafe imports', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'base-'));
    const bytes = Buffer.from('erofs fixture');
    const fetchBase = async () => new Response(bytes);
    const base = { tenantId: 'immo' as const, baseId: 'root', kind: 'rootfs' as const, identityDigest: sha256Hex(bytes) };
    try {
      const path = await ensureBase(base, 'https://s3.example/base', { root: dir, fetchBase });
      expect(readFileSync(path)).toEqual(bytes);
      await expect(ensureBase({ ...base, identityDigest: '0'.repeat(64) }, 'https://s3.example/base', { root: dir, fetchBase })).rejects.toThrow(/digest/);
      await expect(ensureBase(base, 'http://s3.example/base', { root: dir, fetchBase })).rejects.toThrow();
      await expect(ensureBase({ ...base, baseId: '../other' }, 'https://s3.example/base', { root: dir, fetchBase })).rejects.toThrow();
    } finally { rmSync(dir, { recursive: true }); }
  });
});
