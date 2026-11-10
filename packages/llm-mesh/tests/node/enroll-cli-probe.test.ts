import { describe, expect, it } from 'vitest';
import { EXIT_CODES } from '../../src/node/cli/enroll-args.js';
import { runEnroll } from '../../src/node/cli/enroll-command.js';
import { runProbe } from '../../src/node/cli/enroll-cli.js';
import {
  allOutput,
  captureWriters,
  DCA_TOKEN,
  KEY_ENV,
  MINTED_KEY,
  PASSPHRASE,
  REFRESH_TOKEN,
  stubMuseDeviceFetch,
  stubServingFetch,
  tempDir,
} from './enroll-cli-testkit.js';

const env = { [KEY_ENV]: PASSPHRASE };

const enrollOne = async (dir: string): Promise<string> => {
  const { fetchFn } = stubMuseDeviceFetch();
  const writers = captureWriters();
  const code = await runEnroll(
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
  const stored = JSON.parse(writers.outLines[1] as string) as { accountId: string };
  return stored.accountId;
};

describe('llm-mesh-enroll probe (muse-wonder-1.0)', () => {
  it('prints status plus latency plus usage only', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const accountId = await enrollOne(dir);
      const { fetchFn, calls } = stubServingFetch(200, {
        id: 'resp-probe-1',
        output_text: 'probe-secret-text',
        usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
      });
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
        { fetchFn, writers, env },
      );
      expect(code).toBe(EXIT_CODES.ok);
      expect(calls[0]).toBe('https://api.meta.ai/v1/chat/completions');
      expect(writers.outLines).toHaveLength(1);
      const result = JSON.parse(writers.outLines[0] as string) as Record<string, unknown>;
      expect(result.status).toBe('ok');
      expect(typeof result.latencyMs).toBe('number');
      expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 3, totalTokens: 8 });
      const output = allOutput(writers);
      expect(output).not.toContain('probe-secret-text');
      for (const secret of [DCA_TOKEN, MINTED_KEY, REFRESH_TOKEN, PASSPHRASE]) {
        expect(output).not.toContain(secret);
      }
    } finally {
      await cleanup();
    }
  });

  it('maps a 402 to billing_not_configured on the non-seat path', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const accountId = await enrollOne(dir);
      const { fetchFn } = stubServingFetch(402, { error: { message: 'billing check failed' } });
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
        { fetchFn, writers, env },
      );
      expect(code).toBe(EXIT_CODES.billingNotConfigured);
      const output = allOutput(writers);
      expect(output).toContain('billing_not_configured');
      expect(output).toContain('non-seat muse.ts');
      for (const secret of [DCA_TOKEN, MINTED_KEY, REFRESH_TOKEN, PASSPHRASE]) {
        expect(output).not.toContain(secret);
      }
    } finally {
      await cleanup();
    }
  });

  it('refuses an unknown account without leaking the key', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await enrollOne(dir);
      const { fetchFn } = stubServingFetch(200, { output_text: 'hi' });
      const writers = captureWriters();
      const code = await runProbe(
        {
          command: 'probe',
          provider: 'muse-code',
          keyringDir: dir,
          keyringKeyEnv: KEY_ENV,
          account: 'acct_muse_missing',
          model: 'muse-wonder-1.0',
          effort: 'low',
        },
        { fetchFn, writers, env },
      );
      expect(code).toBe(EXIT_CODES.accountNotFound);
      expect(allOutput(writers)).not.toContain(MINTED_KEY);
    } finally {
      await cleanup();
    }
  });
});
