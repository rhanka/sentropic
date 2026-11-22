import { chmod, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deriveKeyringMasterKey,
  EncryptedFileKeyring,
  KeyringInsecurePermissionsError,
} from '../../src/node/keyring/encrypted-file-keyring.js';

const KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const KEY_BUF = deriveKeyringMasterKey(KEY_HEX);
const MODULE_PATH = '../../src/node/keyring/encrypted-file-keyring.js';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const snapshotBytes = async (dir: string): Promise<Map<string, Buffer>> => {
  const entries = (await readdir(dir)).sort();
  const out = new Map<string, Buffer>();
  for (const name of entries) out.set(name, await readFile(join(dir, name)));
  return out;
};

describe('EncryptedFileKeyring read-only explicit key, no rogue .key, and CAS', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('reads with explicit masterKey on a read-only mount without mkdir/chmod or mtime change', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'llm-mesh-kr-ro-'));
    dirs.push(dir);
    const key = 'sentropic-llm-mesh:acct_ro:public';
    const writer = new EncryptedFileKeyring(dir, KEY_BUF);
    await writer.setSecret(key, '{"ok":true}');
    const beforeDir = await stat(dir);
    await sleep(25);

    vi.resetModules();
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      const ro = (op: string) => async (): Promise<never> => {
        throw Object.assign(new Error(`EROFS: ${op}`), { code: 'EROFS' });
      };
      return { ...actual, mkdir: ro('mkdir'), chmod: ro('chmod'), writeFile: ro('writeFile'), rename: ro('rename'), unlink: ro('unlink'), link: ro('link') };
    });
    try {
      const { EncryptedFileKeyring: RoKeyring } = await import(MODULE_PATH);
      const reader = new RoKeyring(dir, KEY_BUF);
      await expect(reader.getSecret(key)).resolves.toBe('{"ok":true}');
    } finally {
      vi.doUnmock('node:fs/promises');
      vi.resetModules();
    }
    const afterDir = await stat(dir);
    expect(afterDir.mtimeMs).toBe(beforeDir.mtimeMs);
    expect(afterDir.ctimeMs).toBe(beforeDir.ctimeMs);
    expect(afterDir.mode & 0o777).toBe(0o700);
  });

  it('refuses explicit-key read on 0755 directory without repairing permissions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'llm-mesh-kr-mode-'));
    dirs.push(dir);
    const key = 'sentropic-llm-mesh:acct_mode:public';
    await new EncryptedFileKeyring(dir, KEY_BUF).setSecret(key, 'v1');
    await chmod(dir, 0o755);

    const err = await new EncryptedFileKeyring(dir, KEY_BUF).getSecret(key).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyringInsecurePermissionsError);
    expect((await stat(dir)).mode & 0o777).toBe(0o755);
  });

  it('refuses to create a .key file next to existing encrypted records lacking .key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'llm-mesh-kr-nokey-'));
    dirs.push(dir);
    await new EncryptedFileKeyring(dir, KEY_BUF).setSecret('sentropic-llm-mesh:accounts:index', '["acct_1"]');
    const before = await snapshotBytes(dir);

    await expect(new EncryptedFileKeyring(dir).setSecret('sentropic-llm-mesh:acct_2:owner', 'x'))
      .rejects.toThrow(/master key is missing/i);
    await expect(stat(join(dir, '.key'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await snapshotBytes(dir)).toEqual(before);
  });

  it('compareAndSetSecrets commits on match, aborts byte-identically on mismatch, and rolls back on write error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'llm-mesh-kr-cas-'));
    dirs.push(dir);
    const kr = new EncryptedFileKeyring(dir, KEY_BUF);
    await kr.setSecret('k:pub', 'pub-v1');
    await kr.setSecret('k:env', 'env-v1');
    await kr.setSecret('k:owner', 'owner-1');

    const beforeMismatch = await snapshotBytes(dir);
    await expect(kr.compareAndSetSecrets(
      [{ key: 'k:env', expected: 'env-v1', secret: 'env-v2' }, { key: 'k:pub', expected: 'pub-stale', secret: 'pub-v2' }],
      [{ key: 'k:owner', expected: 'owner-1' }],
    )).resolves.toBe(false);
    expect(await snapshotBytes(dir)).toEqual(beforeMismatch);

    await expect(kr.compareAndSetSecrets(
      [{ key: 'k:env', expected: 'env-v1', secret: 'env-v2' }, { key: 'k:pub', expected: 'pub-v1', secret: 'pub-v2' }],
      [{ key: 'k:owner', expected: 'owner-1' }],
    )).resolves.toBe(true);
    expect(await kr.getSecret('k:env')).toBe('env-v2');
    expect(await kr.getSecret('k:pub')).toBe('pub-v2');

    const beforeFail = await snapshotBytes(dir);
    vi.resetModules();
    let renames = 0;
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return {
        ...actual,
        rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
          renames += 1;
          if (renames === 2) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
          return actual.rename(from, to);
        },
      };
    });
    try {
      const { EncryptedFileKeyring: FailingKr } = await import(MODULE_PATH);
      await expect(new FailingKr(dir, KEY_BUF).compareAndSetSecrets([
        { key: 'k:env', expected: 'env-v2', secret: 'env-v3' },
        { key: 'k:pub', expected: 'pub-v2', secret: 'pub-v3' },
      ])).rejects.toThrow(/ENOSPC/);
    } finally {
      vi.doUnmock('node:fs/promises');
      vi.resetModules();
    }
    expect(await snapshotBytes(dir)).toEqual(beforeFail);
  });
});
