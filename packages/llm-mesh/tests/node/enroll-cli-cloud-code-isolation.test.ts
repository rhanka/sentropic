// Account isolation and byte-identical failure invariance tests for
// `llm-mesh-enroll enroll --provider cloud-code`. Every secret is fake.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT_CODES } from '../../src/node/cli/enroll-args.js';
import { runEnroll } from '../../src/node/cli/enroll-command.js';
import { deriveKeyringMasterKey, EncryptedFileKeyring } from '../../src/node/keyring/encrypted-file-keyring.js';
import { markExternalSeatAuthority } from '../../src/service/external-seat-authority.js';
import { allOutput, captureWriters, KEY_ENV, PASSPHRASE, tempDir } from './enroll-cli-testkit.js';

const FAKE_ACCESS = 'ya29.fake-iso-access';
const FAKE_REFRESH = '1//fake-iso-refresh';
const FAKE_HOST = 'host-owner-a';
const OWNER_A = `cli:${FAKE_HOST}`;
const OWNER_B = 'cli:foreign-owner-b';
const PAYLOAD = JSON.stringify({ access_token: FAKE_ACCESS, refresh_token: FAKE_REFRESH });

interface DirSnapshot {
  dirMode: number;
  files: Record<string, { bytes: Buffer; mode: number; mtimeMs: number }>;
}

const snap = async (dir: string): Promise<DirSnapshot> => {
  const dirMode = (await stat(dir)).mode & 0o777;
  const files: DirSnapshot['files'] = {};
  for (const name of (await readdir(dir)).sort()) {
    const p = join(dir, name);
    const st = await stat(p);
    files[name] = { bytes: await readFile(p), mode: st.mode & 0o777, mtimeMs: st.mtimeMs };
  }
  return { dirMode, files };
};

const seedAccount = async (
  kr: EncryptedFileKeyring,
  accountId: string,
  ownerScopeRef: string,
  opts: { providerId?: string; transport?: string; target?: string; metadata?: Record<string, unknown>; ownerClaim?: string; removed?: boolean; seatRecord?: boolean } = {},
) => {
  const providerId = opts.providerId ?? 'cloud-code';
  await kr.setSecret(`sentropic-llm-mesh:${accountId}:owner`, JSON.stringify({ v: 1, accountId, ownerScopeRef: opts.ownerClaim ?? ownerScopeRef }));
  await kr.setSecret(`sentropic-llm-mesh:${accountId}:envelope`, JSON.stringify({ accountId, accessToken: 'old-a', refreshToken: 'old-r', expiresAt: '2026-11-01T00:00:00.000Z', authClientConfigVersion: 'v1.0.0' }));
  await kr.setSecret(`sentropic-llm-mesh:${accountId}:public`, JSON.stringify({
    accountId, accountLabel: 'Seat', providerId, status: 'reauth_required',
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z',
    account: { accountId, ownerScopeRef, targetProviderId: opts.target ?? 'gemini', transportProviderId: opts.transport ?? providerId, status: 'reauth_required', metadata: opts.metadata ?? {} },
  }));
  if (opts.removed) {
    await kr.setSecret(`sentropic-llm-mesh:${accountId}:removed`, JSON.stringify({ v: 1, accountId, ownerScopeRef, removedAt: '2026-11-05T00:00:00.000Z' }));
  }
  if (opts.seatRecord) {
    await kr.setSecret(`sentropic-llm-mesh:${accountId}:seat-record`, JSON.stringify({ version: 1, bundle: {}, onboarding: null, storedAt: '2026-11-01T00:00:00.000Z' }));
  }
};

describe('llm-mesh-enroll cloud-code isolation & byte-identical failure invariance', () => {
  it('refuses unknown, removed, foreign-owner, external-seat, and other-provider accounts with zero writes and zero fetch', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const krDir = join(dir, 'kr');
      const kr = new EncryptedFileKeyring(krDir);
      await seedAccount(kr, 'acct_cc_removed', OWNER_A, { removed: true });
      await seedAccount(kr, 'acct_cc_foreign', OWNER_B);
      await seedAccount(kr, 'acct_cc_claim_clash', OWNER_A, { ownerClaim: OWNER_B });
      await seedAccount(kr, 'acct_cc_ext_marker', OWNER_A, {
        metadata: markExternalSeatAuthority({}, { seatRef: 's1', ownerScope: OWNER_A, epoch: 1, generation: 1, operationId: 'op1' }),
      });
      await seedAccount(kr, 'acct_cc_ext_rec', OWNER_A, { seatRecord: true });
      await seedAccount(kr, 'acct_muse_other', OWNER_A, { providerId: 'muse', transport: 'muse', target: 'muse' });

      let fetches = 0;
      const noFetch = (async () => { fetches += 1; throw new Error('must not fetch'); }) as typeof fetch;
      const before = await snap(krDir);

      const cases: { account: string; ownerScope?: string; expected: number }[] = [
        { account: 'acct_cc_unknown', expected: EXIT_CODES.accountNotFound },
        { account: 'acct_cc_removed', expected: EXIT_CODES.accountNotFound },
        { account: 'acct_cc_foreign', expected: EXIT_CODES.usage },
        { account: 'acct_cc_foreign', ownerScope: OWNER_A, expected: EXIT_CODES.usage },
        { account: 'acct_cc_claim_clash', expected: EXIT_CODES.enrollmentFailed },
        { account: 'acct_cc_ext_marker', expected: EXIT_CODES.enrollmentFailed },
        { account: 'acct_cc_ext_rec', expected: EXIT_CODES.enrollmentFailed },
        { account: 'acct_muse_other', expected: EXIT_CODES.accountNotFound },
      ];
      for (const c of cases) {
        const writers = captureWriters();
        const code = await runEnroll(
          { command: 'enroll', provider: 'cloud-code', credentialStdin: true, account: c.account, ownerScope: c.ownerScope, keyringDir: krDir },
          { fetchFn: noFetch, writers, env: {}, readAgyToken: async () => PAYLOAD, hostname: FAKE_HOST },
        );
        expect(code, c.account).toBe(c.expected);
      }
      expect(fetches).toBe(0);
      expect(await snap(krDir)).toEqual(before);
    } finally { await cleanup(); }
  });

  it('never creates .key next to an existing explicit-key keyring and leaves state byte-identical on refresh/resolve errors', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const krDir = join(dir, 'kr-env');
      const kr = new EncryptedFileKeyring(krDir, deriveKeyringMasterKey(PASSPHRASE));
      await seedAccount(kr, 'acct_cc_live', OWNER_A);
      await kr.setSecret('sentropic-llm-mesh:accounts:index', JSON.stringify(['acct_cc_live']));
      const before = await snap(krDir);

      let fetches = 0;
      const noFetch = (async () => { fetches += 1; throw new Error('must not fetch'); }) as typeof fetch;
      const noKeyWriters = captureWriters();
      expect(await runEnroll(
        { command: 'enroll', provider: 'cloud-code', credentialStdin: true, createAccount: true, ownerScope: OWNER_A, keyringDir: krDir },
        { fetchFn: noFetch, writers: noKeyWriters, env: {}, readAgyToken: async () => PAYLOAD, hostname: FAKE_HOST },
      )).toBe(EXIT_CODES.keyringKey);
      expect(fetches).toBe(0);
      await expect(stat(join(krDir, '.key'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await snap(krDir)).toEqual(before);

      const failRefreshFetch = (async () => new Response(JSON.stringify({ error: 'invalid_grant', echo: FAKE_REFRESH }), { status: 400 })) as typeof fetch;
      const w1 = captureWriters();
      expect(await runEnroll(
        { command: 'enroll', provider: 'cloud-code', credentialStdin: true, account: 'acct_cc_live', keyringDir: krDir, keyringKeyEnv: KEY_ENV },
        { fetchFn: failRefreshFetch, writers: w1, env: { [KEY_ENV]: PASSPHRASE }, readAgyToken: async () => PAYLOAD, hostname: FAKE_HOST },
      )).toBe(EXIT_CODES.enrollmentFailed);
      expect(allOutput(w1)).not.toContain(FAKE_REFRESH);
      expect(await snap(krDir)).toEqual(before);

      const failResolveFetch = (async (url: unknown) => String(url).includes('token')
        ? new Response(JSON.stringify({ access_token: 'ya29.tmp', expires_in: 3600 }), { status: 200 })
        : new Response(`boom ${FAKE_ACCESS}`, { status: 503 })) as typeof fetch;
      const w2 = captureWriters();
      expect(await runEnroll(
        { command: 'enroll', provider: 'cloud-code', credentialStdin: true, account: 'acct_cc_live', keyringDir: krDir, keyringKeyEnv: KEY_ENV },
        { fetchFn: failResolveFetch, writers: w2, env: { [KEY_ENV]: PASSPHRASE }, readAgyToken: async () => PAYLOAD, hostname: FAKE_HOST },
      )).toBe(EXIT_CODES.enrollmentFailed);
      expect(allOutput(w2)).not.toContain(FAKE_ACCESS);
      expect(await snap(krDir)).toEqual(before);
    } finally { await cleanup(); }
  });
});
