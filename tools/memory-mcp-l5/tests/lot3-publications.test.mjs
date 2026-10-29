import { describe, expect, it } from 'vitest';
import { integrity } from '../precandidate.mjs';
import { verifyPublication } from '../lot3-publications.mjs';

describe('Lot 3 published archive receipts', () => {
  const bytes = Buffer.from('downloaded archive'), name = '@sentropic/mcp-platform', version = '0.4.0';
  const pkg = { name, version, dist: { integrity: integrity(bytes), tarball: 'https://registry.npmjs.org/archive.tgz' } };
  const entry = { version, integrity: integrity(bytes), resolved: pkg.dist.tarball };
  it('should bind downloaded bytes to npm metadata and the generated registry lock', () => {
    expect(verifyPublication(pkg, bytes, entry, name, version).integrity).toBe(integrity(bytes));
  });
  it('should refuse corrupt bytes, missing lock entries and mismatched metadata or lock fields', () => {
    expect(() => verifyPublication(pkg, Buffer.from('corrupt'), entry, name, version)).toThrow();
    expect(() => verifyPublication(pkg, bytes, undefined, name, version)).toThrow();
    for (const patch of [{ version: '9' }, { integrity: integrity(Buffer.from('foreign')) }, { resolved: 'https://foreign.test' }, { link: true }]) {
      expect(() => verifyPublication(pkg, bytes, { ...entry, ...patch }, name, version)).toThrow();
    }
    for (const patch of [{ name: 'foreign' }, { version: '9' }, { dist: { ...pkg.dist, integrity: 'sha512-forged' } }]) {
      expect(() => verifyPublication({ ...pkg, ...patch }, bytes, entry, name, version)).toThrow();
    }
  });
});
