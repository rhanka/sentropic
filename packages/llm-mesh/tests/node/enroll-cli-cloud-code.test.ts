// Tests for `llm-mesh-enroll enroll --provider cloud-code --from-agy` and
// `llm-mesh-enroll probe --provider cloud-code`. Every secret below is fake
// and must never appear in stdout, stderr, or error messages.
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT_CODES, parseArgs } from '../../src/node/cli/enroll-args.js';
import { run, runProbe } from '../../src/node/cli/enroll-cli.js';
import { runEnroll } from '../../src/node/cli/enroll-command.js';
import { EncryptedFileKeyring } from '../../src/node/keyring/encrypted-file-keyring.js';
import {
  allOutput,
  captureWriters,
  KEY_ENV,
  PASSPHRASE,
  tempDir,
} from './enroll-cli-testkit.js';

const FAKE_AGY_ACCESS = 'ya29.fake-agy-access-token-111';
const FAKE_AGY_REFRESH = '1//fake-agy-refresh-token-222';
const FAKE_FRESH_ACCESS = 'ya29.fake-fresh-access-token-333';
const FAKE_PROJECT = 'aicode-consumers';
const FAKE_TIER = 'g1-ultra-tier';
const FAKE_OWNER_SCOPE = 'cli:test-workstation';
const envWithKey = { [KEY_ENV]: PASSPHRASE };

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

const sseResponse = (text: string, usage: Record<string, number>): Response => {
  const chunk = JSON.stringify({
    response: {
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
      usageMetadata: usage,
    },
  });
  return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
};

const makeAgyJson = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    token: {
      access_token: FAKE_AGY_ACCESS,
      refresh_token: FAKE_AGY_REFRESH,
      token_type: 'Bearer',
      expiry: new Date(Date.now() + 1800_000).toISOString(),
      ...overrides,
    },
    auth_method: 'consumer',
    id_token_email: 'owner@example.test',
  });

const stubCloudCodeEnrollFetch = (options: {
  refreshStatus?: number;
  refreshBody?: unknown;
  project?: string;
  tier?: string;
} = {}): { fetchFn: typeof fetch; urls: string[] } => {
  const urls: string[] = [];
  const fetchFn = (async (url: unknown) => {
    const u = String(url);
    urls.push(u);
    if (u.includes('oauth2.googleapis.com/token')) {
      const status = options.refreshStatus ?? 200;
      if (status !== 200) {
        return jsonResponse(options.refreshBody ?? { error: 'invalid_grant' }, status);
      }
      return jsonResponse({
        access_token: FAKE_FRESH_ACCESS,
        expires_in: 3600,
        token_type: 'Bearer',
      });
    }
    if (u.includes(':loadCodeAssist')) {
      return jsonResponse({
        cloudaicompanionProject: options.project ?? FAKE_PROJECT,
        paidTier: { id: options.tier ?? FAKE_TIER },
      });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch;
  return { fetchFn, urls };
};

const stubCloudCodeProbeFetch = (options: {
  streamStatus?: number;
  models?: string[];
  replyText?: string;
} = {}): { fetchFn: typeof fetch; urls: string[]; streamModels: string[] } => {
  const urls: string[] = [];
  const streamModels: string[] = [];
  const fetchFn = (async (url: unknown, init?: { body?: unknown }) => {
    const u = String(url);
    urls.push(u);
    if (u.includes(':fetchAvailableModels')) {
      const models = Object.fromEntries(
        (options.models ?? ['gemini-4-hydrogen-low', 'gemini-4-hydrogen-high']).map((m) => [m, {}]),
      );
      return jsonResponse({ models });
    }
    if (u.includes(':streamGenerateContent')) {
      if (typeof init?.body === 'string') {
        const body = JSON.parse(init.body) as { model?: string };
        if (body.model) streamModels.push(body.model);
      }
      const status = options.streamStatus ?? 200;
      if (status !== 200) {
        return new Response(`error leaking ${FAKE_FRESH_ACCESS}`, { status });
      }
      return sseResponse(options.replyText ?? 'secret-probe-reply-text', {
        promptTokenCount: 12,
        candidatesTokenCount: 4,
        totalTokenCount: 16,
      });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch;
  return { fetchFn, urls, streamModels };
};

describe('llm-mesh-enroll cloud-code (--from-agy & probe)', () => {
  it('parses --from-agy, --agy-token-file, and defaults cloud-code probe model', () => {
    const enroll = parseArgs([
      'enroll', '--provider', 'cloud-code', '--from-agy',
      '--account', 'acct_cc_existing', '--keyring-dir', '/tmp/kr',
      '--agy-token-file', '/tmp/agy-token',
    ]);
    expect(enroll.provider).toBe('cloud-code');
    expect(enroll.fromAgy).toBe(true);
    expect(enroll.account).toBe('acct_cc_existing');
    expect(enroll.agyTokenFile).toBe('/tmp/agy-token');

    const probe = parseArgs([
      'probe', '--provider', 'cloud-code', '--account', 'acct_cc_existing', '--keyring-dir', '/tmp/kr',
    ]);
    expect(probe.provider).toBe('cloud-code');
    expect(probe.model).toBe('gemini-4-hydrogen');
    expect(probe.effort).toBe('low');
  });

  it('enrolls a new cloud-code account from an agy token file using default .key and prints no secrets', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const tokenFile = join(dir, 'agy-oauth.json');
      await writeFile(tokenFile, makeAgyJson(), { mode: 0o600 });
      const keyringDir = join(dir, 'keyring');
      const { fetchFn, urls } = stubCloudCodeEnrollFetch();
      const writers = captureWriters();

      const code = await run(
        [
          'enroll', '--provider', 'cloud-code', '--from-agy',
          '--keyring-dir', keyringDir,
          '--owner-scope', FAKE_OWNER_SCOPE,
          '--agy-token-file', tokenFile,
        ],
        { fetchFn, writers, env: {} },
      );

      expect(code).toBe(EXIT_CODES.ok);
      expect(urls.some((u) => u.includes('oauth2.googleapis.com/token'))).toBe(true);
      expect(urls.some((u) => u.includes(':loadCodeAssist'))).toBe(true);
      expect(writers.outLines).toHaveLength(1);
      const out = JSON.parse(writers.outLines[0] as string) as Record<string, unknown>;
      expect(out.accountId).toMatch(/^acct_cc_/);
      expect(out.status).toBe('active');
      expect(out.project).toBe(FAKE_PROJECT);
      expect(out.tier).toBe(FAKE_TIER);

      const combined = allOutput(writers);
      for (const secret of [FAKE_AGY_ACCESS, FAKE_AGY_REFRESH, FAKE_FRESH_ACCESS]) {
        expect(combined).not.toContain(secret);
      }

      const kr = new EncryptedFileKeyring(keyringDir);
      const pubRaw = await kr.getSecret(`sentropic-llm-mesh:${String(out.accountId)}:public`);
      expect(pubRaw).toBeTruthy();
      const pub = JSON.parse(pubRaw!) as { status: string; providerId: string; account: { status: string; ownerScopeRef: string } };
      expect(pub.status).toBe('active');
      expect(pub.providerId).toBe('cloud-code');
      expect(pub.account.status).toBe('active');
      expect(pub.account.ownerScopeRef).toBe(FAKE_OWNER_SCOPE);
    } finally {
      await cleanup();
    }
  });

  it('re-enrolls an existing reauth_required account in place without replacing .key', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const keyringDir = join(dir, 'keyring');
      const kr = new EncryptedFileKeyring(keyringDir);
      const accountId = 'acct_cc_mwmxpkle_9xp5f2';
      const originalCreatedAt = '2026-11-19T02:32:01.815Z';
      await kr.setSecret(`sentropic-llm-mesh:${accountId}:owner`, JSON.stringify({
        v: 1, accountId, ownerScopeRef: FAKE_OWNER_SCOPE,
      }));
      await kr.setSecret(`sentropic-llm-mesh:${accountId}:envelope`, JSON.stringify({
        accountId, accessToken: 'old-dead-access', refreshToken: 'old-dead-refresh',
        expiresAt: '2026-11-22T09:36:46.409Z', authClientConfigVersion: 'v1.0.0',
      }));
      await kr.setSecret(`sentropic-llm-mesh:${accountId}:public`, JSON.stringify({
        accountId, accountLabel: 'Cloud Code (aicode-consumers)', providerId: 'cloud-code',
        status: 'reauth_required', createdAt: originalCreatedAt, updatedAt: '2026-11-22T12:27:07.686Z',
        account: {
          accountId, ownerScopeRef: FAKE_OWNER_SCOPE, accountLabel: 'Cloud Code (aicode-consumers)',
          targetProviderId: 'gemini', transportProviderId: 'cloud-code', status: 'reauth_required',
          metadata: { cloudaicompanionProject: FAKE_PROJECT },
        },
      }));
      await kr.setSecret('sentropic-llm-mesh:accounts:index', JSON.stringify([accountId]));
      const keyBefore = await stat(join(keyringDir, '.key'));

      const { fetchFn } = stubCloudCodeEnrollFetch();
      const writers = captureWriters();
      const code = await runEnroll(
        {
          command: 'enroll',
          provider: 'cloud-code',
          fromAgy: true,
          account: accountId,
          keyringDir,
        },
        { fetchFn, writers, env: {}, readAgyToken: async () => makeAgyJson() },
      );

      expect(code).toBe(EXIT_CODES.ok);
      const keyAfter = await stat(join(keyringDir, '.key'));
      expect(keyAfter.ino).toBe(keyBefore.ino);
      expect(keyAfter.mtimeMs).toBe(keyBefore.mtimeMs);
      expect(keyAfter.size).toBe(keyBefore.size);

      const out = JSON.parse(writers.outLines[0] as string) as Record<string, unknown>;
      expect(out.accountId).toBe(accountId);
      expect(out.previousStatus).toBe('reauth_required');
      expect(out.status).toBe('active');

      const updatedPub = JSON.parse(
        (await kr.getSecret(`sentropic-llm-mesh:${accountId}:public`))!,
      ) as { status: string; createdAt: string; account: { status: string; ownerScopeRef: string } };
      expect(updatedPub.status).toBe('active');
      expect(updatedPub.createdAt).toBe(originalCreatedAt);
      expect(updatedPub.account.status).toBe('active');
      expect(updatedPub.account.ownerScopeRef).toBe(FAKE_OWNER_SCOPE);

      const combined = allOutput(writers);
      for (const secret of [FAKE_AGY_ACCESS, FAKE_AGY_REFRESH, FAKE_FRESH_ACCESS, 'old-dead-access', 'old-dead-refresh']) {
        expect(combined).not.toContain(secret);
      }
    } finally {
      await cleanup();
    }
  });

  it('refuses invalid flags, missing/wrong-provider account, and redacts refresh errors', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const noFromAgy = captureWriters();
      expect(await runEnroll(
        { command: 'enroll', provider: 'cloud-code', keyringDir: dir },
        { fetchFn: stubCloudCodeEnrollFetch().fetchFn, writers: noFromAgy, env: {} },
      )).toBe(EXIT_CODES.usage);

      const wrongFromAgy = captureWriters();
      expect(await runEnroll(
        { command: 'enroll', provider: 'muse-code', fromAgy: true, keyringDir: dir, keyringKeyEnv: KEY_ENV, ownerScope: FAKE_OWNER_SCOPE },
        { fetchFn: stubCloudCodeEnrollFetch().fetchFn, writers: wrongFromAgy, env: envWithKey },
      )).toBe(EXIT_CODES.usage);

      const kr = new EncryptedFileKeyring(dir);
      await kr.setSecret('sentropic-llm-mesh:acct_muse_1:public', JSON.stringify({
        accountId: 'acct_muse_1', providerId: 'muse', status: 'active',
        createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
        account: { accountId: 'acct_muse_1', ownerScopeRef: FAKE_OWNER_SCOPE, targetProviderId: 'muse', transportProviderId: 'muse', status: 'active' },
      }));
      let fetched = 0;
      const noCallFetch = (async () => { fetched += 1; throw new Error('must not fetch'); }) as typeof fetch;

      const wrongProvider = captureWriters();
      expect(await runEnroll(
        { command: 'enroll', provider: 'cloud-code', fromAgy: true, account: 'acct_muse_1', keyringDir: dir },
        { fetchFn: noCallFetch, writers: wrongProvider, env: {}, readAgyToken: async () => makeAgyJson() },
      )).toBe(EXIT_CODES.accountNotFound);
      expect(fetched).toBe(0);

      const missingRefresh = captureWriters();
      expect(await runEnroll(
        { command: 'enroll', provider: 'cloud-code', fromAgy: true, keyringDir: dir, ownerScope: FAKE_OWNER_SCOPE },
        { fetchFn: noCallFetch, writers: missingRefresh, env: {}, readAgyToken: async () => makeAgyJson({ refresh_token: '' }) },
      )).toBe(EXIT_CODES.enrollmentFailed);

      const leakyRefresh = captureWriters();
      const { fetchFn: failFetch } = stubCloudCodeEnrollFetch({
        refreshStatus: 400,
        refreshBody: { error: 'invalid_grant', detail: `${FAKE_AGY_REFRESH} ${FAKE_AGY_ACCESS}` },
      });
      expect(await runEnroll(
        { command: 'enroll', provider: 'cloud-code', fromAgy: true, keyringDir: dir, ownerScope: FAKE_OWNER_SCOPE },
        { fetchFn: failFetch, writers: leakyRefresh, env: {}, readAgyToken: async () => makeAgyJson() },
      )).toBe(EXIT_CODES.enrollmentFailed);
      const leaked = allOutput(leakyRefresh);
      expect(leaked).not.toContain(FAKE_AGY_REFRESH);
      expect(leaked).not.toContain(FAKE_AGY_ACCESS);
    } finally {
      await cleanup();
    }
  });

  it('probes an active cloud-code account on gemini-4-hydrogen-low and never leaks text or secrets', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const { fetchFn: enrollFetch } = stubCloudCodeEnrollFetch();
      const enrollWriters = captureWriters();
      expect(await runEnroll(
        {
          command: 'enroll', provider: 'cloud-code', fromAgy: true,
          keyringDir: dir, keyringKeyEnv: KEY_ENV, ownerScope: FAKE_OWNER_SCOPE,
        },
        { fetchFn: enrollFetch, writers: enrollWriters, env: envWithKey, readAgyToken: async () => makeAgyJson() },
      )).toBe(EXIT_CODES.ok);
      const { accountId } = JSON.parse(enrollWriters.outLines[0] as string) as { accountId: string };

      const { fetchFn: probeFetch, streamModels } = stubCloudCodeProbeFetch();
      const probeWriters = captureWriters();
      const code = await runProbe(
        {
          command: 'probe', provider: 'cloud-code', keyringDir: dir, keyringKeyEnv: KEY_ENV,
          account: accountId, model: 'gemini-4-hydrogen', effort: 'low',
        },
        { fetchFn: probeFetch, writers: probeWriters, env: envWithKey },
      );

      expect(code).toBe(EXIT_CODES.ok);
      expect(streamModels).toEqual(['gemini-4-hydrogen-low']);
      expect(probeWriters.outLines).toHaveLength(1);
      const result = JSON.parse(probeWriters.outLines[0] as string) as Record<string, unknown>;
      expect(result.status).toBe('ok');
      expect(result.modelId).toBe('gemini-4-hydrogen');
      expect(result.effort).toBe('low');
      expect(typeof result.latencyMs).toBe('number');
      expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 4, totalTokens: 16 });

      const combined = allOutput(probeWriters);
      expect(combined).not.toContain('secret-probe-reply-text');
      for (const secret of [FAKE_FRESH_ACCESS, FAKE_AGY_REFRESH, PASSPHRASE]) {
        expect(combined).not.toContain(secret);
      }
    } finally {
      await cleanup();
    }
  });

  it('probe refuses reauth_required or non-cloud-code accounts before fetch and redacts transport errors', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const kr = new EncryptedFileKeyring(dir);
      await kr.setSecret('sentropic-llm-mesh:acct_cc_dead:envelope', JSON.stringify({
        accountId: 'acct_cc_dead', accessToken: FAKE_FRESH_ACCESS, refreshToken: FAKE_AGY_REFRESH,
      }));
      await kr.setSecret('sentropic-llm-mesh:acct_cc_dead:public', JSON.stringify({
        accountId: 'acct_cc_dead', providerId: 'cloud-code', status: 'reauth_required',
        account: { status: 'reauth_required', metadata: { cloudaicompanionProject: FAKE_PROJECT } },
      }));
      await kr.setSecret('sentropic-llm-mesh:acct_codex_1:envelope', JSON.stringify({
        accountId: 'acct_codex_1', accessToken: 'codex-secret-token',
      }));
      await kr.setSecret('sentropic-llm-mesh:acct_codex_1:public', JSON.stringify({
        accountId: 'acct_codex_1', providerId: 'codex', status: 'active',
        account: { status: 'active' },
      }));

      let fetched = 0;
      const countingFetch = (async () => { fetched += 1; throw new Error('must not fetch'); }) as typeof fetch;

      const reauthWriters = captureWriters();
      expect(await runProbe(
        { command: 'probe', provider: 'cloud-code', keyringDir: dir, account: 'acct_cc_dead', model: 'gemini-4-hydrogen', effort: 'low' },
        { fetchFn: countingFetch, writers: reauthWriters, env: {} },
      )).toBe(EXIT_CODES.probeFailed);
      expect(fetched).toBe(0);

      const wrongProvWriters = captureWriters();
      expect(await runProbe(
        { command: 'probe', provider: 'cloud-code', keyringDir: dir, account: 'acct_codex_1', model: 'gemini-4-hydrogen', effort: 'low' },
        { fetchFn: countingFetch, writers: wrongProvWriters, env: {} },
      )).toBe(EXIT_CODES.accountNotFound);
      expect(fetched).toBe(0);
      expect(allOutput(wrongProvWriters)).not.toContain('codex-secret-token');

      await kr.setSecret('sentropic-llm-mesh:acct_cc_live:envelope', JSON.stringify({
        accountId: 'acct_cc_live', accessToken: FAKE_FRESH_ACCESS, refreshToken: FAKE_AGY_REFRESH,
      }));
      await kr.setSecret('sentropic-llm-mesh:acct_cc_live:public', JSON.stringify({
        accountId: 'acct_cc_live', providerId: 'cloud-code', status: 'active',
        account: { status: 'active', metadata: { cloudaicompanionProject: FAKE_PROJECT } },
      }));
      const failWriters = captureWriters();
      expect(await runProbe(
        { command: 'probe', provider: 'cloud-code', keyringDir: dir, account: 'acct_cc_live', model: 'gemini-4-hydrogen', effort: 'low' },
        { fetchFn: stubCloudCodeProbeFetch({ streamStatus: 401 }).fetchFn, writers: failWriters, env: {} },
      )).toBe(EXIT_CODES.probeFailed);
      const failOut = allOutput(failWriters);
      expect(failOut).toContain('status 401');
      expect(failOut).not.toContain(FAKE_FRESH_ACCESS);
    } finally {
      await cleanup();
    }
  });
});
