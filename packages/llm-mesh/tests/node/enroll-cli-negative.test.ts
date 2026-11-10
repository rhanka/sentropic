// Negative-path tests for the llm-mesh-enroll review (PR #983 follow-up).
// M1 error sanitizing, B2 provider gate, m2 arg handling.
// Secrets below are fake.
import { describe, expect, it } from 'vitest';
import { EXIT_CODES } from '../../src/node/cli/enroll-args.js';
import { runProbe } from '../../src/node/cli/enroll-cli.js';
import { runEnroll } from '../../src/node/cli/enroll-command.js';
import { deriveKeyringMasterKey, EncryptedFileKeyring } from '../../src/node/keyring/encrypted-file-keyring.js';
import {
  allOutput,
  captureWriters,
  DCA_TOKEN,
  enrollOne,
  KEY_ENV,
  MINTED_KEY,
  OWNER_EMAIL,
  PASSPHRASE,
  REFRESH_TOKEN,
  stubServingFetch,
  tempDir,
} from './enroll-cli-testkit.js';

const env = { [KEY_ENV]: PASSPHRASE };

describe('llm-mesh-enroll negative paths (review follow-up)', () => {
  it('M1: an upstream error body carrying a secret is never relayed', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const leakFetch = (async () => {
        throw new Error(`Muse device poll failed (500): body contains ${DCA_TOKEN} ${MINTED_KEY}`);
      }) as typeof fetch;
      const writers = captureWriters();
      const code = await runEnroll(
        {
          command: 'enroll',
          provider: 'muse-code',
          keyringDir: dir,
          keyringKeyEnv: KEY_ENV,
          ownerScope: 'tenant-1:immo-detection',
        },
        { fetchFn: leakFetch, writers, env },
      );
      expect(code).toBe(EXIT_CODES.enrollmentFailed);
      const output = allOutput(writers);
      expect(output).not.toContain(DCA_TOKEN);
      expect(output).not.toContain(MINTED_KEY);
      expect(output).not.toContain(REFRESH_TOKEN);
    } finally {
      await cleanup();
    }
  });

  it('M1: a probe transport failure relays status only', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const accountId = await enrollOne(dir, OWNER_EMAIL, 'Immo Detection 1');
      const failFetch = (async () => {
        throw Object.assign(new Error(`Muse HTTP error (500): ${MINTED_KEY}`), { status: 500 });
      }) as typeof fetch;
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
        { fetchFn: failFetch, writers, env },
      );
      expect(code).toBe(EXIT_CODES.probeFailed);
      const output = allOutput(writers);
      expect(output).toContain('status 500');
      expect(output).not.toContain(MINTED_KEY);
    } finally {
      await cleanup();
    }
  });

  it('B2: probe refuses a codex account without sending its token', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const key = deriveKeyringMasterKey(PASSPHRASE);
      const keyring = new EncryptedFileKeyring(dir, key);
      const accountId = 'acct_codex_test1';
      await keyring.setSecret(
        `sentropic-llm-mesh:${accountId}:envelope`,
        JSON.stringify({ accessToken: 'codex-oauth-secret-1', refreshToken: 'r', expiresAt: new Date().toISOString() }),
      );
      await keyring.setSecret(
        `sentropic-llm-mesh:${accountId}:public`,
        JSON.stringify({ accountId, providerId: 'codex', status: 'active' }),
      );
      let fetched = 0;
      const countingFetch = (async () => {
        fetched += 1;
        throw new Error('must not fetch');
      }) as typeof fetch;
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
        { fetchFn: countingFetch, writers, env },
      );
      expect(code).toBe(EXIT_CODES.accountNotFound);
      expect(fetched).toBe(0);
      expect(allOutput(writers)).not.toContain('codex-oauth-secret-1');
    } finally {
      await cleanup();
    }
  });

  it('B2: probe with a non-muse-code provider flag is a usage error', async () => {
    const writers = captureWriters();
    const code = await runProbe(
      {
        command: 'probe',
        provider: 'codex',
        keyringDir: '/tmp/nope',
        keyringKeyEnv: KEY_ENV,
        account: 'acct_codex_test1',
        model: 'muse-wonder-1.0',
        effort: 'low',
      },
      { fetchFn: stubServingFetch(200, {}).fetchFn, writers, env },
    );
    expect(code).toBe(EXIT_CODES.usage);
  });

});
