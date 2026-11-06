import { chmod, lstat, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonical, protectedBytes, requestSchema, sha256, writeExclusive } from '../../../src/scripts/cm-preprod-contract';
import { validateBackup } from '../../../src/scripts/cm-preprod-backup';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'a4-preprod-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const dump = '-- PostgreSQL database dump\nCREATE TABLE synthetic();\n-- PostgreSQL database dump complete\n';

describe('protected preprod evidence and tenant backup integrity', () => {
  it('should write exclusively with owner-only permissions and refuse overwrite', async () => {
    const path = join(root, 'checkpoint.json');
    await writeExclusive(path, '{}');
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
    await expect(writeExclusive(path, 'changed')).rejects.toThrow();
    expect((await protectedBytes(path)).toString()).toBe('{}');
  });
  it('should refuse symlinks, group access and oversized checkpoint inputs', async () => {
    const path = join(root, 'checkpoint.json'), link = join(root, 'link');
    await writeExclusive(path, '{}'); await symlink(path, link);
    await expect(protectedBytes(link)).rejects.toThrow();
    await chmod(path, 0o640); await expect(protectedBytes(path)).rejects.toThrow();
    await chmod(path, 0o600); await writeFile(path, Buffer.alloc(32769));
    await expect(protectedBytes(path)).rejects.toThrow();
    await writeFile(path, Buffer.alloc(32768)); expect((await protectedBytes(path)).length).toBe(32768);
  });
  it('should validate compressed bytes without creating a file in dry-run', async () => {
    const bytes = gzipSync(dump), before = await readdir(root);
    const result = await validateBackup(Readable.from([bytes]));
    expect(result).toEqual({ backupSha256: sha256(bytes), backupBytes: bytes.length });
    expect(await readdir(root)).toEqual(before);
  });
  it('should preserve the exact compressed bytes in a 0600 rollback snapshot', async () => {
    const bytes = gzipSync(dump), path = join(root, 'source.sql.gz');
    await validateBackup(Readable.from([bytes.subarray(0, 17), bytes.subarray(17)]), path);
    expect(await protectedBytes(path)).toEqual(bytes);
  });
  for (const [name, bytes] of [['truncated gzip', gzipSync(dump).subarray(0, -2)],
    ['invalid CRC', Buffer.from('not gzip')], ['empty dump', gzipSync('')], ['wrong format', gzipSync('unrelated data')]] as const) {
    it(`should refuse ${name} and remove its incomplete local copy`, async () => {
      const path = join(root, 'source.sql.gz');
      await expect(validateBackup(Readable.from([bytes]), path)).rejects.toThrow('backup_invalid');
      expect(await readdir(root)).toEqual([]);
    });
  }
  it('should fail a broken object-store stream without hanging or leaking its error', async () => {
    async function* broken() { yield gzipSync(dump).subarray(0, 10); throw new Error('PRIVATE-S3-SENTINEL'); }
    await expect(validateBackup(broken())).rejects.toThrow('backup_invalid');
  });
  it('should reject unresolved authorization and non-preprod requests', () => {
    expect(requestSchema.safeParse({ namespace: 'sentropic', authorizationRef: 'pending' }).success).toBe(false);
  });
  it('should hash structured source material independently of object key order', () => {
    expect(sha256(canonical({ b: [{ z: 2, a: 1 }], a: null })))
      .toBe(sha256(canonical({ a: null, b: [{ a: 1, z: 2 }] })));
  });
});
