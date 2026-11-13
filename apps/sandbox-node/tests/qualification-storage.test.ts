import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { createQualificationDirectory, qualificationStorage } from '../src/qualification-storage.js';

vi.mock('node:fs', async original => ({ ...await original<typeof fs>(),
  mkdirSync: vi.fn(), chmodSync: vi.fn(), mkdtempSync: vi.fn(prefix => `${prefix}private`),
  statSync: vi.fn(() => ({ size: 4096 })), statfsSync: vi.fn() }));
afterEach(() => vi.clearAllMocks());

describe('qualification disk admission', () => {
  it.each(['qd', 'qi'] as const)('should put %s images on disk when /run has only 384 MiB', kind => {
    vi.mocked(fs.statfsSync).mockImplementation(path => ({ type: String(path).startsWith('/run') ? 0x01021994n : 0xef53n,
      bavail: String(path).startsWith('/run') ? 384n : 1024n, bsize: 1048576n, ffree: 8192n }) as never);
    expect(createQualificationDirectory('/release', kind)).toBe(`${qualificationStorage}/${kind}-private`);
    expect(fs.statfsSync).toHaveBeenCalledExactlyOnceWith(qualificationStorage, { bigint: true });
    expect(fs.mkdirSync).toHaveBeenCalledWith(qualificationStorage, { recursive: true, mode: 0o700 });
  });
  it.each(['qd', 'qi'] as const)('should refuse low disk capacity or tmpfs before creating %s resources', kind => {
    for (const capacity of [{ type: 0xef53n, bavail: BigInt(kind === 'qi' ? 300 : 170), ffree: 8192n },
      { type: 0x01021994n, bavail: 384n, ffree: 8192n }, { type: 0xef53n, bavail: 1024n, ffree: 1n }]) {
      vi.mocked(fs.statfsSync).mockReturnValue({ ...capacity, bsize: 1048576n } as never);
      expect(() => createQualificationDirectory('/release', kind)).toThrow(/qualification storage.*free bytes.*free inodes/);
      expect(fs.mkdtempSync).not.toHaveBeenCalled();
    }
  });
});
