import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareBundle, destroyBundle } from '../src/bundle.js';
import { qualifyDisk } from '../src/qualification.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), chownSync: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe('filesystem child locale at the exec boundary', () => {
  it.each(['bundle', 'qualification'])('should pin both locales through the default %s launcher', mode => {
    vi.stubEnv('LC_ALL', 'fr_FR.UTF-8');
    vi.stubEnv('LANG', 'fr_FR.UTF-8');
    const root = mkdtempSync(join(tmpdir(), 'child-locale-'));
    try {
      if (mode === 'qualification') {
        vi.stubEnv('QUALIFICATION_ONLY', 'isolated');
        vi.spyOn(process, 'getuid').mockReturnValue(0);
        qualifyDisk();
      } else {
        const bundle = prepareBundle({ tenantId: 'immo', sandboxUid: 'locale', overlayUpper: join(root, 'upper'),
          overlayWork: join(root, 'work'), quotaMiB: 704, diskQuotaMiB: 1, quotaInodes: 32,
          uid: process.getuid!(), gid: process.getgid!(), command: ['/bin/true'],
          mounts: ['rootfs', 'source'].map(kind => ({ source: '/base.erofs', target: `/bases/${kind}/base`, readOnly: true })) });
        destroyBundle(bundle);
      }
      for (const command of ['truncate', 'mkfs.ext4']) {
        const calls = vi.mocked(execFileSync).mock.calls.filter(call => call[0] === command);
        expect(calls).toHaveLength(mode === 'qualification' ? 2 : 1);
        for (const call of calls) expect(call[2]).toMatchObject({ env: { LC_ALL: 'C', LANG: 'C' }, timeout: expect.any(Number) });
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
