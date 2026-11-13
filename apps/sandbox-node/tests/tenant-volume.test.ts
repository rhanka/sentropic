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
  it.each(['truncate', 'mkfs.ext4'])('should map child %s exit errors at the low-water mark', command => {
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
    const failure = Object.assign(new Error('invalid mkfs options'), { status: 1, stderr: Buffer.from('invalid option') });
    expect(() => mountQuotaVolume(bundle, 16, 1024, () => { throw failure; })).toThrow(failure);
  });
  it.each([{ code: 'ETIMEDOUT' }, { signal: 'SIGTERM' }, { killed: true }])
    ('should preserve timeout or termination even with quota evidence: %j', details => {
      vi.mocked(fs.statfsSync).mockReturnValue(capacity(82n * 256n));
      const failure = Object.assign(new Error('terminated'), details, { stderr: Buffer.from('No space left on device') });
      const run = () => { vi.mocked(fs.statfsSync).mockReturnValue(capacity(80n * 256n)); throw failure; };
      expect(() => mountQuotaVolume({ path: '/tenant/test', workspace: '', output: '', mounted: [] }, 16, 1024, run))
        .toThrow(failure);
      vi.mocked(fs.statfsSync).mockReturnValue(capacity(82n * 256n));
      expect(() => mountQuotaVolume({ path: '/tenant/test', workspace: '', output: '', mounted: [] }, 16, 1024,
        () => { vi.mocked(fs.statfsSync).mockReturnValue(capacity(0n)); throw failure; })).toThrow(failure);
    });
  it.each(['No space left on device', 'Disk quota exceeded'])
    ('should map mkfs stderr after concurrent space is freed: %s', message => {
      vi.mocked(fs.statfsSync).mockReturnValue(capacity(82n * 256n));
      const run = vi.fn((command: string) => {
        if (command === 'mkfs.ext4') {
          vi.mocked(fs.statfsSync).mockReturnValue(capacity());
          throw Object.assign(new Error('child failed'), { status: 1, stderr: Buffer.from(`mkfs.ext4: ${message}`) });
        }
      });
      expect(() => mountQuotaVolume({ path: '/tenant/test', workspace: '', output: '', mounted: [] }, 16, 1024, run))
        .toThrow('tenant_quota_exceeded');
      for (const command of ['truncate', 'mkfs.ext4']) expect(run).toHaveBeenCalledWith(command,
        expect.any(Array), { env: expect.objectContaining({ LC_ALL: 'C', LANG: 'C' }) });
    });
  it.each([capacity(80n * 256n), capacity(257n), capacity(256n), capacity(1000000n, 1n)])
    ('should use only a fixed low-water mark after unrelated failure: case %#', remaining => {
      vi.mocked(fs.statfsSync).mockReturnValue(capacity(82n * 256n));
      const failure = new Error('invalid option');
      const run = () => { vi.mocked(fs.statfsSync).mockReturnValue(remaining); throw failure; };
      const invoke = () => mountQuotaVolume({ path: '/tenant/test', workspace: '', output: '', mounted: [] }, 16, 1024, run);
      expect(invoke).toThrow(remaining.bavail <= 256n || remaining.ffree <= 1n ? 'tenant_quota_exceeded' : failure);
    });
  it.each([{ code: 'ENOSPC' }, { code: 'EDQUOT' }, { code: 'UNKNOWN', errno: -28 }, { code: 'UNKNOWN', errno: -122 }])
    ('should map Node quota evidence even when the next statfs would fail: %j', details => {
      vi.mocked(fs.statfsSync).mockReturnValueOnce(capacity());
      vi.mocked(fs.statfsSync).mockImplementation(() => { throw new Error('statfs failed'); });
      expect(() => mountQuotaVolume({ path: '/tenant/test', workspace: '', output: '', mounted: [] }, 16, 1024,
        () => { throw Object.assign(new Error('write failed'), details); })).toThrow('tenant_quota_exceeded');
      expect(fs.statfsSync).toHaveBeenCalledTimes(1);
    });
  it('should preserve the original error when secondary statfs fails', () => {
    vi.mocked(fs.statfsSync).mockReturnValueOnce(capacity());
    vi.mocked(fs.statfsSync).mockImplementation(() => { throw new Error('statfs failed'); });
    const failure = new Error('invalid option');
    expect(() => mountQuotaVolume({ path: '/tenant/test', workspace: '', output: '', mounted: [] }, 16, 1024,
      () => { throw failure; })).toThrow(failure);
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
