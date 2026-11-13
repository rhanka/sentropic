import { describe, expect, it, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { mountQuotaVolume } from '../src/disk-quota.js';
import { ensureBase } from '../src/base-store.js';
import * as promises from 'node:fs/promises';

vi.mock('node:fs', async original => ({ ...await original<typeof fs>(), mkdirSync: vi.fn(), statfsSync: vi.fn() }));
vi.mock('node:fs/promises', async original => ({ ...await original<typeof promises>(), mkdir: vi.fn(), open: vi.fn(), rm: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const capacity = (bavail = 1000000n, ffree = 1000n) => ({ bavail, bsize: 4096n, ffree }) as fs.BigIntStatsFs;

describe('tenant volume exhaustion', () => {
  it.each(['truncate', 'mkfs.ext4'])('should map child %s exit errors using free blocks/inodes, without stderr parsing', command => {
    for (const full of [capacity(0n), capacity(1000000n, 0n)]) {
      vi.mocked(fs.statfsSync).mockReturnValue(capacity());
      const failure = Object.assign(new Error('command failed'), { status: 1, stderr: Buffer.from('localized failure') });
      const run = vi.fn((name: string) => {
        if (name === command) { vi.mocked(fs.statfsSync).mockReturnValue(full); throw failure; }
      });
      expect(() => mountQuotaVolume({ path: '/tenant/sandboxes/test', workspace: '', output: '', mounted: [] }, 16, 1024, run))
        .toThrow('tenant_quota_exceeded');
    }
  });
  it('should refuse insufficient capacity before running children and preserve unrelated exits', () => {
    const bundle = { path: '/tenant/test', workspace: '', output: '', mounted: [] };
    const run = vi.fn();
    vi.mocked(fs.statfsSync).mockReturnValue(capacity(1n));
    expect(() => mountQuotaVolume(bundle, 16, 1024, run)).toThrow('tenant_quota_exceeded');
    expect(run).not.toHaveBeenCalled();
    vi.mocked(fs.statfsSync).mockReturnValue(capacity());
    const failure = Object.assign(new Error('invalid mkfs options'), { status: 1, stderr: Buffer.from('No space left on device') });
    expect(() => mountQuotaVolume(bundle, 16, 1024, () => { throw failure; })).toThrow(failure);
  });
  it.each(['mkdir', 'open', 'write'])('should map UNKNOWN/-122 or ENOSPC during base %s', async stage => {
    for (const failure of [{ code: 'UNKNOWN', errno: -122 }, { code: 'ENOSPC' }]) {
      vi.mocked(promises.mkdir).mockResolvedValue(undefined);
      const file = { writeFile: vi.fn(), close: vi.fn() };
      vi.mocked(promises.open).mockResolvedValue(file as never);
      if (stage === 'mkdir') vi.mocked(promises.mkdir).mockRejectedValue(failure);
      if (stage === 'open') vi.mocked(promises.open).mockRejectedValue(failure);
      if (stage === 'write') file.writeFile.mockRejectedValue(failure);
      const base = { tenantId: 'immo' as const, baseId: 'b', kind: 'source' as const, identityDigest: '0'.repeat(64) };
      await expect(ensureBase(base, 'https://sentropic-execution-bhs.s3.bhs.io.cloud.ovh.net/tenants/immo/preprod/base',
        { root: '/unused', fetchBase: async () => new Response('fixture') })).rejects.toThrow('tenant_quota_exceeded');
      if (stage === 'write') { expect(file.close).toHaveBeenCalled(); expect(promises.rm).toHaveBeenCalled(); }
    }
  });
});
