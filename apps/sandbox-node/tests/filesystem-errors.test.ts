import { describe, expect, it, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { constants } from 'node:os';
import { prepareBundle } from '../src/bundle.js';
import { writeSource } from '../src/source-write.js';
import { readOutput } from '../src/output.js';
import { quotaWriter } from '../src/qualification.js';
import { isEdquot, throwFilesystemError } from '../src/filesystem-errors.js';

vi.mock('node:fs', async original => ({ ...await original<typeof fs>(), mkdirSync: vi.fn(), writeFileSync: vi.fn(),
  rmSync: vi.fn(), lstatSync: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe('Linux errno mapping', () => {
  const unknownQuota = Object.assign(new Error('UNKNOWN'), { code: 'UNKNOWN', errno: -constants.errno.EDQUOT });
  it('should recognize EDQUOT by code or negative errno only', () => {
    expect(isEdquot(unknownQuota)).toBe(true);
    expect(isEdquot({ code: 'EDQUOT' })).toBe(true);
    for (const value of [null, {}, { errno: constants.errno.EDQUOT }, { code: 'UNKNOWN' }]) expect(isEdquot(value)).toBe(false);
    for (const code of ['EROFS', 'EXDEV', 'ELOOP', 'ENOTEMPTY'] as const) {
      const error = Object.assign(new Error('UNKNOWN'), { code: 'UNKNOWN', errno: -constants.errno[code] });
      expect(() => throwFilesystemError(error)).toThrow(error);
    }
  });
  it('should accept UNKNOWN/-122 in the unprivileged qualification writer', () => {
    vi.stubEnv('QUALIFICATION_ONLY', 'isolated');
    vi.mocked(fs.writeFileSync).mockImplementation(() => { throw unknownQuota; });
    expect(() => quotaWriter()).not.toThrow();
    vi.mocked(fs.writeFileSync).mockImplementation(() => { throw new Error('unrelated'); });
    expect(() => quotaWriter()).toThrow('unrelated');
  });
  it.each(['EDQUOT', 'ENOSPC'] as const)('should map UNKNOWN/%s in source, bundle and export paths', code => {
    const failure = Object.assign(new Error('UNKNOWN'), { code: 'UNKNOWN', errno: -constants.errno[code] });
    vi.mocked(fs.lstatSync).mockImplementation(() => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); });
    vi.mocked(fs.mkdirSync).mockImplementation(() => { throw failure; });
    const scope = { kind: 'ui' as const, writable: ['ui/**'], refused: [], source: { repo: 'r', path: 'r.ts', commit: 'a' } };
    expect(() => writeSource('/tmp', '/workspace/ui/a.ts', Buffer.from('a'), scope)).toThrow('tenant_quota_exceeded');
    expect(() => prepareBundle({ tenantId: 'immo', sandboxUid: 'q', overlayUpper: '/tmp/q/upper', overlayWork: '/tmp/q/work',
      quotaMiB: 704, uid: 1000, gid: 1000, command: ['/bin/true'],
      mounts: ['rootfs', 'source'].map(kind => ({ source: '/image', target: `/bases/${kind}/base`, readOnly: true })) }))
      .toThrow('tenant_quota_exceeded');
    vi.mocked(fs.lstatSync).mockImplementation(() => { throw failure; });
    expect(() => readOutput('/tmp', 'ui/dist')).toThrow('tenant_quota_exceeded');
  });
});
