// Hardening tests for the llm-mesh-enroll review (PR #983 follow-up).
// B1 bin, M2 strict key, M3 typed keyring exits, M4 repeatable and perms.
// Secrets below are fake.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXIT_CODES } from '../../src/node/cli/enroll-args.js';
import { run, runProbe } from '../../src/node/cli/enroll-cli.js';
import { runEnroll } from '../../src/node/cli/enroll-command.js';
import { deriveKeyringMasterKey } from '../../src/node/keyring/encrypted-file-keyring.js';
import {
  allOutput,
  captureWriters,
  enrollOne,
  KEY_ENV,
  OWNER_EMAIL,
  PASSPHRASE,
  stubMuseDeviceFetch,
  stubServingFetch,
  tempDir,
} from './enroll-cli-testkit.js';

const env = { [KEY_ENV]: PASSPHRASE };

describe('llm-mesh-enroll hardening (review follow-up)', () => {
  it('B1: the bin entry is a dedicated unconditional entry point', async () => {
    const here = fileURLToPath(new URL('.', import.meta.url));
    const pkg = JSON.parse(
      await readFile(join(here, '../../package.json'), 'utf8'),
    ) as { bin: Record<string, string> };
    expect(pkg.bin['llm-mesh-enroll']).toBe('./dist/node/cli/bin.js');
    const binSrc = await readFile(join(here, '../../src/node/cli/bin.ts'), 'utf8');
    expect(binSrc).not.toContain('endsWith');
    expect(binSrc).toContain('run(argv.slice(2))');
    const cliSrc = await readFile(join(here, '../../src/node/cli/enroll-cli.ts'), 'utf8');
    expect(cliSrc).not.toContain('endsWith');
    expect(cliSrc).not.toContain('invokedDirectly');
  });

  it('B1: run dispatches help without a bin guard', async () => {
    const writers = captureWriters();
    const code = await run(['help'], { writers, env, fetchFn: stubMuseDeviceFetch().fetchFn });
    expect(code).toBe(EXIT_CODES.ok);
    expect(writers.outLines.join('\n')).toContain('llm-mesh-enroll enroll');
  });

  it('M4: repeatable enrollments for N accounts land in one keyring', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const first = await enrollOne(dir, 'owner-1@example.test', 'Immo Detection 1');
      const second = await enrollOne(dir, 'owner-2@example.test', 'Immo Detection 2');
      expect(second).not.toBe(first);
      const files = await readdir(dir);
      expect(files.filter((f) => f.endsWith('.json')).length).toBeGreaterThanOrEqual(4);
    } finally {
      await cleanup();
    }
  });

  it('M4: explicit-key keyring uses 0700/0600 and stores no .key file', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await enrollOne(dir, OWNER_EMAIL, 'Immo Detection 1');
      const dirStat = await stat(dir);
      expect(dirStat.mode & 0o777).toBe(0o700);
      for (const file of await readdir(dir)) {
        if (!file.endsWith('.json')) continue;
        expect((await stat(join(dir, file))).mode & 0o777).toBe(0o600);
      }
      await expect(readFile(join(dir, '.key'))).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });

  it('M2+M3: a weak passphrase is refused with exit 5 and no secret leaks', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      expect(() => deriveKeyringMasterKey('human-passphrase')).toThrow();
      const writers = captureWriters();
      const code = await runEnroll(
        {
          command: 'enroll',
          provider: 'muse-code',
          keyringDir: dir,
          keyringKeyEnv: KEY_ENV,
          ownerScope: 'tenant-1:immo-detection',
        },
        { fetchFn: stubMuseDeviceFetch().fetchFn, writers, env: { [KEY_ENV]: 'weak' } },
      );
      expect(code).toBe(EXIT_CODES.keyringKey);
      expect(allOutput(writers)).not.toContain('weak');
    } finally {
      await cleanup();
    }
  });

  it('M3: a wrong key maps the keyring read to exit 5', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const accountId = await enrollOne(dir, OWNER_EMAIL, 'Immo Detection 1');
      const { fetchFn } = stubServingFetch(200, { output_text: 'hi' });
      const writers = captureWriters();
      const code = await runProbe(
        {
          command: 'probe',
          provider: 'muse-code',
          keyringDir: dir,
          keyringKeyEnv: KEY_ENV,
          account: accountId,
          model: 'muse-wonder-1.0',
          effort: 'low',
        },
        {
          fetchFn,
          writers,
          env: {
            [KEY_ENV]: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          },
        },
      );
      expect(code).toBe(EXIT_CODES.keyringKey);
    } finally {
      await cleanup();
    }
  });

});
