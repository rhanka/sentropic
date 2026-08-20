import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EncryptedFileKeyring } from '../../src/node/keyring/encrypted-file-keyring.js';

describe('EncryptedFileKeyring', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, {
      recursive: true,
      force: true,
    })));
  });

  it('shares encrypted secrets between process-local instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'llm-mesh-keyring-'));
    directories.push(directory);
    const secret = 'refresh-token-that-must-not-be-stored-in-plaintext';
    const writer = new EncryptedFileKeyring(directory);
    const reader = new EncryptedFileKeyring(directory);

    await writer.setSecret('sentropic-llm-mesh:acct_1:envelope', secret);

    await expect(reader.getSecret('sentropic-llm-mesh:acct_1:envelope')).resolves.toBe(secret);
    const files = await readdir(directory);
    const recordFile = files.find((file) => file.endsWith('.json'));
    expect(recordFile).toBeDefined();
    expect(await readFile(join(directory, recordFile!), 'utf8')).not.toContain(secret);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, '.key'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(directory, recordFile!))).mode & 0o777).toBe(0o600);

    await reader.deleteSecret('sentropic-llm-mesh:acct_1:envelope');
    await expect(writer.getSecret('sentropic-llm-mesh:acct_1:envelope')).resolves.toBeNull();
  });

  it('creates an encrypted owner claim exactly once across instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'llm-mesh-keyring-'));
    directories.push(directory);
    const first = new EncryptedFileKeyring(directory);
    const second = new EncryptedFileKeyring(directory);
    const key = 'sentropic-llm-mesh:acct_collision:owner';

    const created = await Promise.all([
      first.setSecretIfAbsent(key, 'owner-a'),
      second.setSecretIfAbsent(key, 'owner-b'),
    ]);

    expect(created.sort()).toEqual([false, true]);
    await expect(first.getSecret(key)).resolves.toMatch(/^owner-[ab]$/);
  });
});
