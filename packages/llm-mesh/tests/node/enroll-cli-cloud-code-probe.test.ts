// Read-only probe invariance across every option combination (bytes, mode, mtime).
import { chmod, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT_CODES } from '../../src/node/cli/enroll-args.js';
import { runProbe } from '../../src/node/cli/enroll-cli.js';
import { deriveKeyringMasterKey, EncryptedFileKeyring } from '../../src/node/keyring/encrypted-file-keyring.js';
import { allOutput, captureWriters, KEY_ENV, PASSPHRASE, tempDir } from './enroll-cli-testkit.js';

const OWNER = 'cli:probe-host';
const PROJECT = 'aicode-consumers';
const envWithKey = { [KEY_ENV]: PASSPHRASE };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const snap = async (dir: string) => {
  const dirStat = await stat(dir);
  const files: Record<string, { bytes: Buffer; mode: number; mtimeMs: number }> = {};
  for (const name of (await readdir(dir)).sort()) {
    const st = await stat(join(dir, name));
    files[name] = { bytes: await readFile(join(dir, name)), mode: st.mode & 0o777, mtimeMs: st.mtimeMs };
  }
  return { dirMode: dirStat.mode & 0o777, dirMtimeMs: dirStat.mtimeMs, files };
};

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

const stubProbeFetch = (status = 200): typeof fetch => (async (url: unknown) => {
  const u = String(url);
  if (u.includes(':fetchAvailableModels')) return json({ models: { 'gemini-4-hydrogen-low': {} } });
  if (u.includes(':streamGenerateContent')) {
    if (status !== 200) return new Response('err ya29.probe-secret', { status });
    const chunk = JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'hidden-reply' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 } } });
    return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
  throw new Error(`unexpected: ${u}`);
}) as typeof fetch;

const seed = async (kr: EncryptedFileKeyring, id: string, status = 'active', removed = false, providerId = 'cloud-code') => {
  await kr.setSecret(`sentropic-llm-mesh:${id}:owner`, JSON.stringify({ v: 1, accountId: id, ownerScopeRef: OWNER }));
  await kr.setSecret(`sentropic-llm-mesh:${id}:envelope`, JSON.stringify({ accountId: id, accessToken: 'ya29.probe-secret', refreshToken: '1//r', expiresAt: '2099-01-01T00:00:00.000Z', authClientConfigVersion: 'v1.0.0' }));
  await kr.setSecret(`sentropic-llm-mesh:${id}:public`, JSON.stringify({
    accountId: id, providerId, status, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
    account: { accountId: id, ownerScopeRef: OWNER, targetProviderId: providerId === 'cloud-code' ? 'gemini' : providerId, transportProviderId: providerId, status, metadata: { cloudaicompanionProject: PROJECT } },
  }));
  if (removed) await kr.setSecret(`sentropic-llm-mesh:${id}:removed`, JSON.stringify({ v: 1, accountId: id, ownerScopeRef: OWNER, removedAt: '2026-11-11T00:00:00.000Z' }));
};

const seedMisbound = async (kr: EncryptedFileKeyring, id: string, wrong: 'public' | 'inner' | 'envelope') => {
  const other = 'acct_cc_other';
  await kr.setSecret(`sentropic-llm-mesh:${id}:owner`, JSON.stringify({ v: 1, accountId: id, ownerScopeRef: OWNER }));
  await kr.setSecret(`sentropic-llm-mesh:${id}:envelope`, JSON.stringify({
    accountId: wrong === 'envelope' ? other : id, accessToken: 'ya29.probe-secret', refreshToken: '1//r',
    expiresAt: '2099-01-01T00:00:00.000Z', authClientConfigVersion: 'v1.0.0',
  }));
  await kr.setSecret(`sentropic-llm-mesh:${id}:public`, JSON.stringify({
    accountId: wrong === 'public' ? other : id, providerId: 'cloud-code', status: 'active',
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
    account: {
      accountId: wrong === 'inner' ? other : id, ownerScopeRef: OWNER, targetProviderId: 'gemini',
      transportProviderId: 'cloud-code', status: 'active', metadata: { cloudaicompanionProject: PROJECT },
    },
  }));
};

describe('llm-mesh-enroll probe --provider cloud-code account binding', () => {
  it('fails closed before any fetch when :public or :envelope is bound to another account, and trims --account', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const krDir = join(dir, 'kr-bind');
      const kr = new EncryptedFileKeyring(krDir, deriveKeyringMasterKey(PASSPHRASE));
      await seedMisbound(kr, 'acct_cc_bad_public', 'public');
      await seedMisbound(kr, 'acct_cc_bad_inner', 'inner');
      await seedMisbound(kr, 'acct_cc_bad_env', 'envelope');
      await seed(kr, 'acct_cc_ok', 'active');
      await sleep(25);
      const before = await snap(krDir);
      let fetches = 0;
      const countingFetch = (async (...a: Parameters<typeof fetch>) => {
        fetches += 1;
        return stubProbeFetch(200)(...a);
      }) as typeof fetch;
      const probeId = (account: string) => runProbe(
        { command: 'probe', provider: 'cloud-code', keyringDir: krDir, account, model: 'gemini-4-hydrogen', effort: 'low', keyringKeyEnv: KEY_ENV },
        { fetchFn: countingFetch, writers: captureWriters(), env: envWithKey },
      );
      expect(await probeId('acct_cc_bad_public')).toBe(EXIT_CODES.probeFailed);
      expect(await probeId('acct_cc_bad_inner')).toBe(EXIT_CODES.probeFailed);
      expect(await probeId('acct_cc_bad_env')).toBe(EXIT_CODES.probeFailed);
      expect(fetches).toBe(0);
      expect(await probeId('  acct_cc_ok  ')).toBe(EXIT_CODES.ok);
      expect(fetches).toBeGreaterThan(0);
      expect(await snap(krDir)).toEqual(before);
    } finally { await cleanup(); }
  });
});

describe('llm-mesh-enroll probe --provider cloud-code read-only invariance', () => {
  it('writes nothing across .key and --keyring-key-env combinations (bytes, mode, mtime)', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      for (const useEnvKey of [false, true]) {
        const krDir = join(dir, useEnvKey ? 'kr-env' : 'kr-file');
        const kr = useEnvKey ? new EncryptedFileKeyring(krDir, deriveKeyringMasterKey(PASSPHRASE)) : new EncryptedFileKeyring(krDir);
        await seed(kr, 'acct_cc_ok', 'active');
        await seed(kr, 'acct_cc_dead', 'reauth_required');
        await seed(kr, 'acct_cc_rem', 'active', true);
        await seed(kr, 'acct_codex_1', 'active', false, 'codex');
        await sleep(25);
        const before = await snap(krDir);
        const keyOpt = useEnvKey ? { keyringKeyEnv: KEY_ENV } : {};
        const env = useEnvKey ? envWithKey : {};

        const wOk = captureWriters();
        expect(await runProbe({ command: 'probe', provider: 'cloud-code', keyringDir: krDir, account: 'acct_cc_ok', model: 'gemini-4-hydrogen', effort: 'low', ...keyOpt }, { fetchFn: stubProbeFetch(200), writers: wOk, env })).toBe(EXIT_CODES.ok);
        expect(JSON.parse(wOk.outLines[0] as string)).toMatchObject({ status: 'ok', modelId: 'gemini-4-hydrogen', effort: 'low', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } });
        expect(allOutput(wOk)).not.toContain('hidden-reply');
        expect(allOutput(wOk)).not.toContain('ya29.probe-secret');

        const w401 = captureWriters();
        expect(await runProbe({ command: 'probe', provider: 'cloud-code', keyringDir: krDir, account: 'acct_cc_ok', model: 'gemini-4-hydrogen', effort: 'low', ...keyOpt }, { fetchFn: stubProbeFetch(401), writers: w401, env })).toBe(EXIT_CODES.probeFailed);
        expect(allOutput(w401)).toContain('status 401');
        expect(allOutput(w401)).not.toContain('ya29.probe-secret');

        expect(await runProbe({ command: 'probe', provider: 'cloud-code', keyringDir: krDir, account: 'acct_cc_dead', model: 'gemini-4-hydrogen', effort: 'low', ...keyOpt }, { fetchFn: stubProbeFetch(200), writers: captureWriters(), env })).toBe(EXIT_CODES.probeFailed);
        expect(await runProbe({ command: 'probe', provider: 'cloud-code', keyringDir: krDir, account: 'acct_cc_rem', model: 'gemini-4-hydrogen', effort: 'low', ...keyOpt }, { fetchFn: stubProbeFetch(200), writers: captureWriters(), env })).toBe(EXIT_CODES.accountNotFound);
        expect(await runProbe({ command: 'probe', provider: 'cloud-code', keyringDir: krDir, account: 'acct_codex_1', model: 'gemini-4-hydrogen', effort: 'low', ...keyOpt }, { fetchFn: stubProbeFetch(200), writers: captureWriters(), env })).toBe(EXIT_CODES.accountNotFound);
        expect(await runProbe({ command: 'probe', provider: 'cloud-code', keyringDir: krDir, account: 'acct_missing', model: 'gemini-4-hydrogen', effort: 'low', ...keyOpt }, { fetchFn: stubProbeFetch(200), writers: captureWriters(), env })).toBe(EXIT_CODES.accountNotFound);
        if (useEnvKey) {
          expect(await runProbe({ command: 'probe', provider: 'cloud-code', keyringDir: krDir, account: 'acct_cc_ok', model: 'gemini-4-hydrogen', effort: 'low', keyringKeyEnv: KEY_ENV }, { fetchFn: stubProbeFetch(200), writers: captureWriters(), env: { [KEY_ENV]: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' } })).toBe(EXIT_CODES.keyringKey);
        }
        expect(await snap(krDir)).toEqual(before);

        const missingDir = join(dir, useEnvKey ? 'missing-env' : 'missing-file');
        expect(await runProbe({ command: 'probe', provider: 'cloud-code', keyringDir: missingDir, account: 'acct_cc_ok', model: 'gemini-4-hydrogen', effort: 'low', ...keyOpt }, { fetchFn: stubProbeFetch(200), writers: captureWriters(), env })).toBe(EXIT_CODES.accountNotFound);
        await expect(stat(missingDir)).rejects.toMatchObject({ code: 'ENOENT' });

        await chmod(krDir, 0o755);
        await sleep(25);
        const beforeBadMode = await snap(krDir);
        expect(await runProbe({ command: 'probe', provider: 'cloud-code', keyringDir: krDir, account: 'acct_cc_ok', model: 'gemini-4-hydrogen', effort: 'low', ...keyOpt }, { fetchFn: stubProbeFetch(200), writers: captureWriters(), env })).toBe(EXIT_CODES.keyringKey);
        expect(await snap(krDir)).toEqual(beforeBadMode);
      }
    } finally { await cleanup(); }
  });
});
