// Arg-handling tests for the llm-mesh-enroll review (PR #983 follow-up).
// m2: unknown provider, unknown flags, flag value hygiene, corrupt envelope.
import { describe, expect, it } from 'vitest';
import { EXIT_CODES, parseArgs } from '../../src/node/cli/enroll-args.js';
import { runProbe } from '../../src/node/cli/enroll-cli.js';
import { runEnroll } from '../../src/node/cli/enroll-command.js';
import { deriveKeyringMasterKey, EncryptedFileKeyring } from '../../src/node/keyring/encrypted-file-keyring.js';
import {
  captureWriters,
  KEY_ENV,
  OWNER_EMAIL,
  PASSPHRASE,
  stubMuseDeviceFetch,
  stubServingFetch,
  tempDir,
} from './enroll-cli-testkit.js';

const env = { [KEY_ENV]: PASSPHRASE };

describe('llm-mesh-enroll arg handling (review follow-up)', () => {
  it('m2: unknown provider in enroll is a usage error', async () => {
    const writers = captureWriters();
    const code = await runEnroll(
      {
        command: 'enroll',
        provider: 'gemini',
        keyringDir: '/tmp/nope',
        keyringKeyEnv: KEY_ENV,
        ownerScope: 'tenant-1:immo-detection',
      },
      { fetchFn: stubMuseDeviceFetch().fetchFn, writers, env },
    );
    expect(code).toBe(EXIT_CODES.usage);
  });

  it('m2: unknown flags are rejected and a flag never eats the next flag', async () => {
    expect(() => parseArgs(['enroll', '--provider', 'muse-code', '--nope', 'x'])).toThrow(
      "unknown flag '--nope'",
    );
    const parsed = parseArgs(['enroll', '--keyring-dir', '--account', 'a', '--provider', 'muse-code']);
    expect(parsed.keyringDir).toBeUndefined();
    expect(parsed.account).toBe('a');
  });

  it('m2: a corrupt credential envelope maps to probeFailed, not accountNotFound', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const { fetchFn } = stubMuseDeviceFetch();
      const enrolled = captureWriters();
      const enrollCode = await runEnroll(
        {
          command: 'enroll',
          provider: 'muse-code',
          keyringDir: dir,
          keyringKeyEnv: KEY_ENV,
          ownerScope: 'tenant-1:immo-detection',
        },
        { fetchFn, writers: enrolled, env },
      );
      expect(enrollCode).toBe(EXIT_CODES.ok);
      const accountId = (JSON.parse(enrolled.outLines[1] as string) as { accountId: string }).accountId;
      const key = deriveKeyringMasterKey(PASSPHRASE);
      const keyring = new EncryptedFileKeyring(dir, key);
      await keyring.setSecret(`sentropic-llm-mesh:${accountId}:envelope`, 'not-json{{{');
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
        { fetchFn: stubServingFetch(200, {}).fetchFn, writers, env },
      );
      expect(code).toBe(EXIT_CODES.probeFailed);
    } finally {
      await cleanup();
    }
  });
});
