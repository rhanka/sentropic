// Core enroll tests for `llm-mesh-enroll enroll --provider cloud-code`
// (--from-agy via fake secret-tool, --credential-stdin, --create-account,
// allowlisted :public stripping legacy secrets, no email on stdout).
import { chmod, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT_CODES, parseArgs } from '../../src/node/cli/enroll-args.js';
import { run } from '../../src/node/cli/enroll-cli.js';
import { runEnroll } from '../../src/node/cli/enroll-command.js';
import { EncryptedFileKeyring } from '../../src/node/keyring/encrypted-file-keyring.js';
import { allOutput, captureWriters, makeSessionBusSocket, tempDir } from './enroll-cli-testkit.js';

const FAKE_AGY_ACCESS = 'ya29.fake-cc-access-111';
const FAKE_AGY_REFRESH = '1//fake-cc-refresh-222';
const FAKE_FRESH_ACCESS = 'ya29.fake-cc-fresh-333';
const FAKE_PROJECT = 'aicode-consumers';
const FAKE_TIER = 'g1-ultra-tier';
const FAKE_HOST = 'workstation-test';
const FAKE_OWNER = `cli:${FAKE_HOST}`;
const FAKE_EMAIL = 'private-owner@example.test';

const makeAgyJson = (): string => JSON.stringify({
  token: { access_token: FAKE_AGY_ACCESS, refresh_token: FAKE_AGY_REFRESH, token_type: 'Bearer', expiry: '2026-12-01T00:00:00.000Z' },
  auth_method: 'consumer',
  id_token_email: FAKE_EMAIL,
});

const streamOf = (text: string) => ({
  isTTY: false,
  async *[Symbol.asyncIterator]() { yield Buffer.from(text, 'utf8'); },
});

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

const stubEnrollFetch = (): typeof fetch => (async (url: unknown) => {
  const u = String(url);
  if (u.includes('oauth2.googleapis.com/token')) {
    return json({ access_token: FAKE_FRESH_ACCESS, expires_in: 3600, token_type: 'Bearer' });
  }
  if (u.includes(':loadCodeAssist')) {
    return json({ cloudaicompanionProject: FAKE_PROJECT, paidTier: { id: FAKE_TIER } });
  }
  throw new Error(`unexpected fetch: ${u}`);
}) as typeof fetch;

describe('llm-mesh-enroll cloud-code core (--from-agy, --credential-stdin, --create-account)', () => {
  it('enforces explicit --account or --create-account and rejects blank/conflicting flags', async () => {
    const parsed = parseArgs(['enroll', '--provider', 'cloud-code', '--from-agy', '--account', 'acct_cc_1', '--keyring-dir', '/tmp/kr']);
    expect(parsed.fromAgy).toBe(true);
    expect(parsed.account).toBe('acct_cc_1');
    expect(() => parseArgs(['enroll', '--provider', 'cloud-code', '--from-agy=yes'])).toThrow();

    const badInvocations: string[][] = [
      ['enroll', '--provider', 'cloud-code', '--keyring-dir', '/tmp/kr', '--account', 'acct_cc_1'],
      ['enroll', '--provider', 'cloud-code', '--from-agy', '--credential-stdin', '--keyring-dir', '/tmp/kr', '--account', 'acct_cc_1'],
      ['enroll', '--provider', 'cloud-code', '--from-agy', '--keyring-dir', '/tmp/kr'],
      ['enroll', '--provider', 'cloud-code', '--from-agy', '--account=', '--keyring-dir', '/tmp/kr'],
      ['enroll', '--provider', 'cloud-code', '--from-agy', '--account', '   ', '--keyring-dir', '/tmp/kr'],
      ['enroll', '--provider', 'cloud-code', '--from-agy', '--account', '--keyring-dir', '/tmp/kr'],
      ['enroll', '--provider', 'cloud-code', '--from-agy', '--create-account', '--account', 'acct_1', '--owner-scope', FAKE_OWNER, '--keyring-dir', '/tmp/kr'],
      ['enroll', '--provider', 'cloud-code', '--from-agy', '--create-account', '--keyring-dir', '/tmp/kr'],
    ];
    for (const argv of badInvocations) {
      const writers = captureWriters();
      expect(await run(argv, { fetchFn: stubEnrollFetch(), writers, env: {}, hostname: FAKE_HOST })).toBe(EXIT_CODES.usage);
    }
  });

  it('creates a new account only with --create-account --owner-scope via --credential-stdin and never emits email', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const krDir = join(dir, 'keyring');
      const writers = captureWriters();
      const code = await run(
        ['enroll', '--provider', 'cloud-code', '--credential-stdin', '--create-account', '--owner-scope', FAKE_OWNER, '--keyring-dir', krDir],
        { fetchFn: stubEnrollFetch(), writers, env: {}, stdin: streamOf(makeAgyJson()), hostname: FAKE_HOST },
      );
      expect(code).toBe(EXIT_CODES.ok);
      const out = JSON.parse(writers.outLines[0] as string) as Record<string, unknown>;
      expect(out.accountId).toMatch(/^acct_cc_/);
      expect(out.status).toBe('active');
      expect(out.label).toBe(`Cloud Code (${FAKE_PROJECT})`);
      const combined = allOutput(writers);
      for (const forbidden of [FAKE_AGY_ACCESS, FAKE_AGY_REFRESH, FAKE_FRESH_ACCESS, FAKE_EMAIL]) {
        expect(combined).not.toContain(forbidden);
      }
      const kr = new EncryptedFileKeyring(krDir);
      const owner = JSON.parse((await kr.getSecret(`sentropic-llm-mesh:${String(out.accountId)}:owner`))!) as Record<string, unknown>;
      expect(owner).toEqual({ v: 1, accountId: out.accountId, ownerScopeRef: FAKE_OWNER });
    } finally { await cleanup(); }
  });

  it('re-enrolls existing account via --from-agy (fake secret-tool), preserves .key, and strips legacy secrets from :public', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const krDir = join(dir, 'keyring');
      const kr = new EncryptedFileKeyring(krDir);
      const accountId = 'acct_cc_existing_1';
      await kr.setSecret(`sentropic-llm-mesh:${accountId}:owner`, JSON.stringify({ v: 1, accountId, ownerScopeRef: FAKE_OWNER }));
      await kr.setSecret(`sentropic-llm-mesh:${accountId}:envelope`, JSON.stringify({
        accountId, accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: '2026-11-01T00:00:00.000Z', authClientConfigVersion: 'v1.0.0',
      }));
      await kr.setSecret(`sentropic-llm-mesh:${accountId}:public`, JSON.stringify({
        accountId, accountLabel: 'Existing Seat', providerId: 'cloud-code', status: 'reauth_required',
        createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
        leakedTopSecret: 'top-secret',
        account: {
          accountId, ownerScopeRef: FAKE_OWNER, accountLabel: 'Existing Seat', targetProviderId: 'gemini',
          transportProviderId: 'cloud-code', status: 'reauth_required', priority: 2,
          accessToken: 'legacy-leaked-access', refreshToken: 'legacy-leaked-refresh', expiresAt: '2026-01-01T00:00:00.000Z',
          rogueField: 'drop-me', metadata: { cloudaicompanionProject: FAKE_PROJECT, rogueMeta: 'drop-meta' },
        },
      }));
      await kr.setSecret('sentropic-llm-mesh:accounts:index', JSON.stringify([accountId]));
      const keyBefore = await stat(join(krDir, '.key'));

      const bus = await makeSessionBusSocket(dir);
      const fakeTool = join(dir, 'fake-secret-tool');
      await writeFile(fakeTool, [
        '#!/bin/sh',
        `if [ "$DBUS_SESSION_BUS_ADDRESS" != "${bus.address}" ]; then exit 7; fi`,
        `printf '%s' '${makeAgyJson()}'`,
        '',
      ].join('\n'), { mode: 0o700 });
      await chmod(fakeTool, 0o700);
      const writers = captureWriters();
      const code = await runEnroll(
        { command: 'enroll', provider: 'cloud-code', fromAgy: true, account: accountId, keyringDir: krDir },
        {
          fetchFn: stubEnrollFetch(), writers, hostname: FAKE_HOST, secretToolPath: fakeTool,
          env: { DBUS_SESSION_BUS_ADDRESS: bus.address },
        },
      );
      await bus.close();
      expect(code).toBe(EXIT_CODES.ok);
      const keyAfter = await stat(join(krDir, '.key'));
      expect([keyAfter.ino, keyAfter.mtimeMs, keyAfter.size]).toEqual([keyBefore.ino, keyBefore.mtimeMs, keyBefore.size]);

      const pub = JSON.parse((await kr.getSecret(`sentropic-llm-mesh:${accountId}:public`))!) as Record<string, any>;
      expect(pub.status).toBe('active');
      expect(pub.createdAt).toBe('2026-11-01T00:00:00.000Z');
      expect('leakedTopSecret' in pub).toBe(false);
      expect(pub.account.priority).toBe(2);
      for (const bad of ['accessToken', 'refreshToken', 'expiresAt', 'rogueField']) {
        expect(bad in pub.account).toBe(false);
      }
      expect('rogueMeta' in pub.account.metadata).toBe(false);
      expect(allOutput(writers)).not.toContain(FAKE_EMAIL);
    } finally { await cleanup(); }
  });
});
