import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT_CODES } from '../../src/node/cli/enroll-args.js';
import { runEnroll as runEnrollDirect } from '../../src/node/cli/enroll-command.js';
import {
  allOutput,
  captureWriters,
  DCA_TOKEN,
  KEY_ENV,
  MINTED_KEY,
  OWNER_EMAIL,
  PASSPHRASE,
  REFRESH_TOKEN,
  stubMuseDeviceFetch,
  tempDir,
} from './enroll-cli-testkit.js';

const env = { [KEY_ENV]: PASSPHRASE };

describe('llm-mesh-enroll enroll (muse-code device flow)', () => {
  it('completes the happy path and stores the account', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const { fetchFn } = stubMuseDeviceFetch();
      const writers = captureWriters();
      const code = await runEnrollDirect(
        {
          command: 'enroll',
          provider: 'muse-code',
          keyringDir: dir,
          keyringKeyEnv: KEY_ENV,
          ownerScope: 'tenant-1:immo-detection',
          label: 'Immo Detection 1',
        },
        { fetchFn, writers, env },
      );
      expect(code).toBe(EXIT_CODES.ok);
      expect(writers.outLines).toHaveLength(2);
      const grant = JSON.parse(writers.outLines[0] as string) as Record<string, unknown>;
      expect(grant.verificationUrl).toContain('accountscenter.meta.com/muse_code/');
      expect(grant.userCode).toBe('USER-TEST-1');
      const stored = JSON.parse(writers.outLines[1] as string) as Record<string, unknown>;
      expect(stored.accountId).toMatch(/^acct_muse_/);
      expect(stored.label).toBe('Immo Detection 1');
      // Repeatable: a second enrollment lands in the same keyring.
      expect(await readdir(dir)).not.toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  it('prints only the grant on the first stdout line', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const { fetchFn } = stubMuseDeviceFetch();
      const writers = captureWriters();
      await runEnrollDirect(
        {
          command: 'enroll',
          provider: 'muse-code',
          keyringDir: dir,
          keyringKeyEnv: KEY_ENV,
          ownerScope: 'tenant-1:immo-detection',
        },
        { fetchFn, writers, env },
      );
      const grant = JSON.parse(writers.outLines[0] as string) as Record<string, unknown>;
      expect(Object.keys(grant).sort()).toEqual(['expiresAt', 'userCode', 'verificationUrl']);
    } finally {
      await cleanup();
    }
  });

  it('reads the key by env name and never prints secrets', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const { fetchFn } = stubMuseDeviceFetch();
      const missing = captureWriters();
      const missingCode = await runEnrollDirect(
        {
          command: 'enroll',
          provider: 'muse-code',
          keyringDir: dir,
          ownerScope: 'tenant-1:immo-detection',
        },
        { fetchFn, writers: missing, env },
      );
      expect(missingCode).toBe(EXIT_CODES.keyringKey);

      const writers = captureWriters();
      const code = await runEnrollDirect(
        {
          command: 'enroll',
          provider: 'muse-code',
          keyringDir: dir,
          keyringKeyEnv: KEY_ENV,
          ownerScope: 'tenant-1:immo-detection',
        },
        { fetchFn, writers, env },
      );
      expect(code).toBe(EXIT_CODES.ok);
      const output = allOutput(writers);
      for (const secret of [DCA_TOKEN, MINTED_KEY, REFRESH_TOKEN, PASSPHRASE]) {
        expect(output).not.toContain(secret);
      }
      // The keyring files hold ciphertext only.
      for (const file of await readdir(dir)) {
        if (!file.endsWith('.json')) continue;
        const raw = await readFile(join(dir, file), 'utf8');
        expect(raw).not.toContain(MINTED_KEY);
        expect(raw).not.toContain(DCA_TOKEN);
      }
      // The stored envelope reloads through the same env key.
      expect(output).toContain(OWNER_EMAIL);
    } finally {
      await cleanup();
    }
  });
});
