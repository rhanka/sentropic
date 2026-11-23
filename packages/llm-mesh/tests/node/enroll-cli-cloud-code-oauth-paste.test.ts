// `enroll --provider cloud-code --oauth-paste`: dedicated in-pod PKCE grant.
// Preflight runs before any authorization URL is printed, no keyring lock is
// held while waiting for the pasted callback, and the pasted code/state and
// minted tokens never appear in CLI output. Every secret below is fake.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT_CODES, parseArgs } from '../../src/node/cli/enroll-args.js';
import { run } from '../../src/node/cli/enroll-cli.js';
import { runEnroll } from '../../src/node/cli/enroll-command.js';
import { EncryptedFileKeyring } from '../../src/node/keyring/encrypted-file-keyring.js';
import { allOutput, captureWriters, tempDir } from './enroll-cli-testkit.js';

type CliWritersCapture = ReturnType<typeof captureWriters>;

const HOST = 'paste-host';
const OWNER = `cli:${HOST}`;
const PROJECT = 'aicode-consumers';
const NEW_ACCESS = 'ya29.fake-paste-access';
const NEW_REFRESH = '1//fake-paste-refresh-dedicated';
const PASTED_CODE = '4/fake-pasted-code-123';

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

interface PasteFetch {
  fetchFn: typeof fetch;
  tokenBodies: URLSearchParams[];
  calls: string[];
}

const stubPasteFetch = (opts: { withRefresh?: boolean } = {}): PasteFetch => {
  const tokenBodies: URLSearchParams[] = [];
  const calls: string[] = [];
  const fetchFn = (async (url: unknown, init?: { body?: unknown }) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('oauth2.googleapis.com/token')) {
      const body = new URLSearchParams(String(init?.body ?? ''));
      tokenBodies.push(body);
      if (body.get('grant_type') !== 'authorization_code') throw new Error('expected authorization_code grant');
      return json({
        access_token: NEW_ACCESS, expires_in: 3600, token_type: 'Bearer',
        ...(opts.withRefresh === false ? {} : { refresh_token: NEW_REFRESH }),
      });
    }
    if (u.includes(':loadCodeAssist')) return json({ cloudaicompanionProject: PROJECT, paidTier: { id: 'g1-ultra-tier' } });
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch;
  return { fetchFn, tokenBodies, calls };
};

const snap = async (dir: string) => {
  const files: Record<string, Buffer> = {};
  for (const name of (await readdir(dir)).sort()) files[name] = await readFile(join(dir, name));
  return { dirMode: (await stat(dir)).mode & 0o777, files };
};

const seedPasteAccount = async (kr: EncryptedFileKeyring, id: string) => {
  await kr.setSecret(`sentropic-llm-mesh:${id}:owner`, JSON.stringify({ v: 1, accountId: id, ownerScopeRef: OWNER }));
  await kr.setSecret(`sentropic-llm-mesh:${id}:envelope`, JSON.stringify({
    accountId: id, accessToken: 'ya29.old', refreshToken: '1//old', expiresAt: '2026-11-01T00:00:00.000Z', authClientConfigVersion: 'v1.0.0',
  }));
  await kr.setSecret(`sentropic-llm-mesh:${id}:public`, JSON.stringify({
    accountId: id, accountLabel: 'Prod Seat', providerId: 'cloud-code', status: 'reauth_required',
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
    account: {
      accountId: id, ownerScopeRef: OWNER, accountLabel: 'Prod Seat', targetProviderId: 'gemini',
      transportProviderId: 'cloud-code', status: 'reauth_required', metadata: { cloudaicompanionProject: PROJECT },
    },
  }));
  await kr.setSecret('sentropic-llm-mesh:accounts:index', JSON.stringify([id]));
};

/** stdin whose single line is pushed by the test after the URL is printed. */
const controllableStdin = () => {
  let push: (line: string) => void = () => {};
  const linePromise = new Promise<string>((resolve) => { push = resolve; });
  const stream = {
    isTTY: false,
    async *[Symbol.asyncIterator]() { yield Buffer.from(await linePromise, 'utf8'); },
  };
  return { stream, push };
};

const waitForFirstLine = async (writers: CliWritersCapture): Promise<Record<string, unknown>> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (writers.outLines[0]) return JSON.parse(writers.outLines[0]) as Record<string, unknown>;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('authorization URL line was never printed');
};

const callbackFor = (firstLine: Record<string, unknown>, form: 'url' | 'code#state' = 'url'): string => {
  const url = new URL(String(firstLine.authorizationUrl));
  const state = url.searchParams.get('state');
  expect(state).toBeTruthy();
  expect(url.searchParams.get('access_type')).toBe('offline');
  expect(url.searchParams.get('prompt')).toBe('consent');
  expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1/oauth/callback');
  return form === 'url'
    ? `http://127.0.0.1:1/oauth/callback?state=${state}&code=${PASTED_CODE}&scope=openid\n`
    : `${PASTED_CODE}#${state}\n`;
};

describe('llm-mesh-enroll cloud-code --oauth-paste', () => {
  it('parses the flag and enforces exactly one credential source', async () => {
    expect(parseArgs(['enroll', '--provider', 'cloud-code', '--oauth-paste', '--keyring-dir', '/tmp/kr']).oauthPaste).toBe(true);
    for (const argv of [
      ['enroll', '--provider', 'cloud-code', '--oauth-paste', '--from-agy', '--account', 'a1', '--keyring-dir', '/tmp/kr'],
      ['enroll', '--provider', 'cloud-code', '--oauth-paste', '--credential-stdin', '--account', 'a1', '--keyring-dir', '/tmp/kr'],
      ['enroll', '--provider', 'muse-code', '--oauth-paste', '--owner-scope', 'o', '--keyring-dir', '/tmp/kr'],
    ]) {
      expect(await run(argv, { fetchFn: stubPasteFetch().fetchFn, writers: captureWriters(), env: {}, hostname: HOST }))
        .toBe(EXIT_CODES.usage);
    }
  });

  it('mints a dedicated grant from a pasted callback URL and commits it in place', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const krDir = join(dir, 'kr-paste');
      const kr = new EncryptedFileKeyring(krDir);
      await seedPasteAccount(kr, 'acct_cc_prod');
      const stub = stubPasteFetch();
      const writers = captureWriters();
      const stdin = controllableStdin();
      const pending = runEnroll(
        { command: 'enroll', provider: 'cloud-code', oauthPaste: true, account: 'acct_cc_prod', keyringDir: krDir },
        { fetchFn: stub.fetchFn, writers, env: {}, stdin: stdin.stream, hostname: HOST },
      );
      const first = await waitForFirstLine(writers);
      expect(typeof first.expiresAt).toBe('string');
      stdin.push(callbackFor(first));
      expect(await pending).toBe(EXIT_CODES.ok);

      expect(stub.tokenBodies).toHaveLength(1);
      expect(stub.tokenBodies[0]?.get('code')).toBe(PASTED_CODE);
      expect(stub.tokenBodies[0]?.get('code_verifier')).toBeTruthy();
      expect(stub.tokenBodies[0]?.get('redirect_uri')).toBe('http://127.0.0.1:1/oauth/callback');
      const envelope = JSON.parse((await kr.getSecret('sentropic-llm-mesh:acct_cc_prod:envelope'))!) as Record<string, unknown>;
      expect(envelope).toMatchObject({ accountId: 'acct_cc_prod', accessToken: NEW_ACCESS, refreshToken: NEW_REFRESH });
      const pub = JSON.parse((await kr.getSecret('sentropic-llm-mesh:acct_cc_prod:public'))!) as { status: string };
      expect(pub.status).toBe('active');
      const last = JSON.parse(writers.outLines[1] as string) as Record<string, unknown>;
      expect(last).toMatchObject({ accountId: 'acct_cc_prod', providerId: 'cloud-code', status: 'active' });
      for (const forbidden of [PASTED_CODE, NEW_ACCESS, NEW_REFRESH]) {
        expect(allOutput(writers)).not.toContain(forbidden);
      }
    } finally { await cleanup(); }
  });

  it('accepts code#state and creates an account only with --create-account --owner-scope', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const krDir = join(dir, 'kr-paste-new');
      const stub = stubPasteFetch();
      const writers = captureWriters();
      const stdin = controllableStdin();
      const pending = run(
        ['enroll', '--provider', 'cloud-code', '--oauth-paste', '--create-account', '--owner-scope', OWNER, '--keyring-dir', krDir],
        { fetchFn: stub.fetchFn, writers, env: {}, stdin: stdin.stream, hostname: HOST },
      );
      stdin.push(callbackFor(await waitForFirstLine(writers), 'code#state'));
      expect(await pending).toBe(EXIT_CODES.ok);
      const out = JSON.parse(writers.outLines[1] as string) as { accountId: string };
      expect(out.accountId).toMatch(/^acct_cc_/);
      const kr = new EncryptedFileKeyring(krDir);
      expect(JSON.parse((await kr.getSecret(`sentropic-llm-mesh:${out.accountId}:envelope`))!))
        .toMatchObject({ refreshToken: NEW_REFRESH });
      expect(JSON.parse((await kr.getSecret('sentropic-llm-mesh:accounts:index'))!)).toEqual([out.accountId]);
    } finally { await cleanup(); }
  });

  it('runs account preflight before printing any authorization URL or fetching', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const krDir = join(dir, 'kr-paste-pre');
      const kr = new EncryptedFileKeyring(krDir);
      await seedPasteAccount(kr, 'acct_cc_prod');
      const before = await snap(krDir);
      const stub = stubPasteFetch();
      const writers = captureWriters();
      expect(await runEnroll(
        { command: 'enroll', provider: 'cloud-code', oauthPaste: true, account: 'acct_cc_unknown', keyringDir: krDir },
        { fetchFn: stub.fetchFn, writers, env: {}, stdin: controllableStdin().stream, hostname: HOST },
      )).toBe(EXIT_CODES.accountNotFound);
      expect(writers.outLines).toEqual([]);
      expect(stub.calls).toEqual([]);
      expect(await snap(krDir)).toEqual(before);
    } finally { await cleanup(); }
  });

  it('rejects wrong-state, stateless, TTY and timed-out pastes without writes, fetches, or echoing the paste', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const krDir = join(dir, 'kr-paste-bad');
      const kr = new EncryptedFileKeyring(krDir);
      await seedPasteAccount(kr, 'acct_cc_prod');
      const before = await snap(krDir);

      const runPaste = (
        paste: string | null, opts: { timeoutMs?: number; tty?: boolean } = {},
      ) => {
        const stub = stubPasteFetch();
        const writers = captureWriters();
        const stdin = controllableStdin();
        const stream = opts.tty ? { ...stdin.stream, isTTY: true } : stdin.stream;
        const pending = runEnroll(
          { command: 'enroll', provider: 'cloud-code', oauthPaste: true, account: 'acct_cc_prod', keyringDir: krDir },
          {
            fetchFn: stub.fetchFn, writers, env: {}, stdin: stream, hostname: HOST,
            ...(opts.timeoutMs ? { oauthPasteTimeoutMs: opts.timeoutMs } : {}),
          },
        );
        return { stub, writers, stdin, pending };
      };

      const wrongState = runPaste(null);
      await waitForFirstLine(wrongState.writers);
      wrongState.stdin.push(`http://127.0.0.1:1/oauth/callback?state=attacker-state&code=${PASTED_CODE}\n`);
      expect(await wrongState.pending).toBe(EXIT_CODES.enrollmentFailed);
      expect(wrongState.stub.calls).toEqual([]);

      const stateless = runPaste(null);
      await waitForFirstLine(stateless.writers);
      stateless.stdin.push(`${PASTED_CODE}\n`);
      expect(await stateless.pending).toBe(EXIT_CODES.enrollmentFailed);
      expect(stateless.stub.calls).toEqual([]);

      const tty = runPaste(null, { tty: true });
      expect(await tty.pending).toBe(EXIT_CODES.enrollmentFailed);
      expect(tty.stub.calls).toEqual([]);

      const stalled = runPaste(null, { timeoutMs: 80 });
      await waitForFirstLine(stalled.writers);
      expect(await stalled.pending).toBe(EXIT_CODES.enrollmentFailed);
      expect(allOutput(stalled.writers)).toMatch(/timed out/i);

      for (const w of [wrongState.writers, stateless.writers, tty.writers, stalled.writers]) {
        expect(allOutput(w)).not.toContain(PASTED_CODE);
        expect(allOutput(w)).not.toContain('attacker-state');
      }
      expect(await snap(krDir)).toEqual(before);
    } finally { await cleanup(); }
  });

  it('fails closed when the token exchange returns no refresh token', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const krDir = join(dir, 'kr-paste-norefresh');
      const kr = new EncryptedFileKeyring(krDir);
      await seedPasteAccount(kr, 'acct_cc_prod');
      const before = await snap(krDir);
      const stub = stubPasteFetch({ withRefresh: false });
      const writers = captureWriters();
      const stdin = controllableStdin();
      const pending = runEnroll(
        { command: 'enroll', provider: 'cloud-code', oauthPaste: true, account: 'acct_cc_prod', keyringDir: krDir },
        { fetchFn: stub.fetchFn, writers, env: {}, stdin: stdin.stream, hostname: HOST },
      );
      stdin.push(callbackFor(await waitForFirstLine(writers)));
      expect(await pending).toBe(EXIT_CODES.enrollmentFailed);
      expect(allOutput(writers)).toMatch(/no refresh token/i);
      expect(await snap(krDir)).toEqual(before);
    } finally { await cleanup(); }
  });
});
