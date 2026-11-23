// Bidirectional compare-and-set tests between CLI enroll and custodian refresh.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CloudCodeEnrollmentProvider } from '../../src/enrollment/cloud-code.js';
import { EXIT_CODES } from '../../src/node/cli/enroll-args.js';
import { runEnroll } from '../../src/node/cli/enroll-command.js';
import { EncryptedFileKeyring } from '../../src/node/keyring/encrypted-file-keyring.js';
import { LocalAccountTransportService } from '../../src/service/local-account-transport-service.js';
import { captureWriters, tempDir } from './enroll-cli-testkit.js';

const FAKE_HOST = 'cas-host';
const OWNER = `cli:${FAKE_HOST}`;
const PROJECT = 'aicode-consumers';
const PAYLOAD = JSON.stringify({ access_token: 'ya29.in', refresh_token: '1//in' });

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

const snap = async (dir: string) => {
  const files: Record<string, Buffer> = {};
  for (const name of (await readdir(dir)).sort()) files[name] = await readFile(join(dir, name));
  return { dirMode: (await stat(dir)).mode & 0o777, files };
};

const seedOwnerless = async (kr: EncryptedFileKeyring, id: string) => {
  await kr.setSecret(`sentropic-llm-mesh:${id}:envelope`, JSON.stringify({ accountId: id, accessToken: 'ya29.old', refreshToken: '1//old', expiresAt: '2026-11-01T00:00:00.000Z', authClientConfigVersion: 'v1.0.0' }));
  await kr.setSecret(`sentropic-llm-mesh:${id}:public`, JSON.stringify({
    accountId: id, accountLabel: 'Legacy Seat', providerId: 'cloud-code', status: 'reauth_required',
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
    account: { accountId: id, ownerScopeRef: OWNER, accountLabel: 'Legacy Seat', targetProviderId: 'gemini', transportProviderId: 'cloud-code', status: 'reauth_required', metadata: { cloudaicompanionProject: PROJECT } },
  }));
  await kr.setSecret('sentropic-llm-mesh:accounts:index', JSON.stringify([id]));
};

const seedExpiring = async (kr: EncryptedFileKeyring, id: string) => {
  await kr.setSecret(`sentropic-llm-mesh:${id}:owner`, JSON.stringify({ v: 1, accountId: id, ownerScopeRef: OWNER }));
  await kr.setSecret(`sentropic-llm-mesh:${id}:envelope`, JSON.stringify({ accountId: id, accessToken: 'ya29.old', refreshToken: '1//old', expiresAt: new Date(Date.now() + 60_000).toISOString(), authClientConfigVersion: 'v1.0.0' }));
  await kr.setSecret(`sentropic-llm-mesh:${id}:public`, JSON.stringify({
    accountId: id, accountLabel: 'Cloud Code (aicode-consumers)', providerId: 'cloud-code', status: 'active',
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
    account: { accountId: id, ownerScopeRef: OWNER, accountLabel: 'Cloud Code (aicode-consumers)', targetProviderId: 'gemini', transportProviderId: 'cloud-code', status: 'active', metadata: { cloudaicompanionProject: PROJECT } },
  }));
  await kr.setSecret('sentropic-llm-mesh:accounts:index', JSON.stringify([id]));
};

describe('CLI enroll vs custodian refresh compare-and-set', () => {
  it.each([400, 200] as const)('custodian refresh finishing with HTTP %s never clobbers concurrent CLI re-enrollment', async (custodianStatus) => {
    const { dir, cleanup } = await tempDir();
    try {
      const krDir = join(dir, 'kr-cas1');
      const kr = new EncryptedFileKeyring(krDir);
      await seedExpiring(kr, 'acct_cc_race1');

      let releaseCustodian!: (res: Response) => void;
      let custodianStarted!: () => void;
      const started = new Promise<void>((r) => { custodianStarted = r; });
      const custodianFetch = (async () => {
        custodianStarted();
        return new Promise<Response>((resolve) => { releaseCustodian = resolve; });
      }) as typeof fetch;
      const service = new LocalAccountTransportService(
        new EncryptedFileKeyring(krDir),
        new Map([['cloud-code', new CloudCodeEnrollmentProvider({ fetchFn: custodianFetch })]]),
        { resolveConfig: async () => ({}) },
      );

      const cycle = service.runCustodianRefreshCycle();
      await started;

      const cliFetch = (async (url: unknown) => String(url).includes('token')
        ? json({ access_token: 'ya29.cli-winner', refresh_token: '1//cli-winner', expires_in: 3600 })
        : json({ cloudaicompanionProject: PROJECT, paidTier: { id: 'g1-ultra-tier' } })) as typeof fetch;
      expect(await runEnroll(
        { command: 'enroll', provider: 'cloud-code', credentialStdin: true, account: 'acct_cc_race1', keyringDir: krDir },
        { fetchFn: cliFetch, writers: captureWriters(), env: {}, readAgyToken: async () => PAYLOAD, hostname: FAKE_HOST },
      )).toBe(EXIT_CODES.ok);

      releaseCustodian(custodianStatus === 400
        ? json({ error: 'invalid_grant' }, 400)
        : json({ access_token: 'ya29.custodian-stale', refresh_token: '1//custodian-stale', expires_in: 3600 }));
      await cycle;

      const pub = JSON.parse((await kr.getSecret('sentropic-llm-mesh:acct_cc_race1:public'))!) as { status: string };
      const env = JSON.parse((await kr.getSecret('sentropic-llm-mesh:acct_cc_race1:envelope'))!) as { accessToken: string };
      expect(pub.status).toBe('active');
      expect(env.accessToken).toBe('ya29.cli-winner');
    } finally { await cleanup(); }
  });

  it('CLI re-enrollment finishing after concurrent custodian refresh aborts without clobbering', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const krDir = join(dir, 'kr-cas2');
      const kr = new EncryptedFileKeyring(krDir);
      await seedExpiring(kr, 'acct_cc_race2');

      let releaseCli!: (res: Response) => void;
      let cliStarted!: () => void;
      const started = new Promise<void>((r) => { cliStarted = r; });
      const cliFetch = (async (url: unknown) => {
        if (String(url).includes('token')) {
          cliStarted();
          return new Promise<Response>((resolve) => { releaseCli = resolve; });
        }
        return json({ cloudaicompanionProject: PROJECT });
      }) as typeof fetch;

      const cliPromise = runEnroll(
        { command: 'enroll', provider: 'cloud-code', credentialStdin: true, account: 'acct_cc_race2', keyringDir: krDir },
        { fetchFn: cliFetch, writers: captureWriters(), env: {}, readAgyToken: async () => PAYLOAD, hostname: FAKE_HOST },
      );
      await started;

      const custodianFetch = (async () => json({ access_token: 'ya29.custodian-winner', refresh_token: '1//custodian-winner', expires_in: 3600 })) as typeof fetch;
      const service = new LocalAccountTransportService(
        new EncryptedFileKeyring(krDir),
        new Map([['cloud-code', new CloudCodeEnrollmentProvider({ fetchFn: custodianFetch })]]),
        { resolveConfig: async () => ({}) },
      );
      await service.runCustodianRefreshCycle();
      const afterCustodian = await snap(krDir);

      releaseCli(json({ access_token: 'ya29.cli-stale', expires_in: 3600 }));
      expect(await cliPromise).toBe(EXIT_CODES.enrollmentFailed);
      expect(await snap(krDir)).toEqual(afterCustodian);
      const env = JSON.parse((await kr.getSecret('sentropic-llm-mesh:acct_cc_race2:envelope'))!) as { accessToken: string };
      expect(env.accessToken).toBe('ya29.custodian-winner');
    } finally { await cleanup(); }
  });

  it('commits :owner creation inside the same CAS: an aborted ownerless re-enroll leaves no :owner behind', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const krDir = join(dir, 'kr-cas3');
      const kr = new EncryptedFileKeyring(krDir);
      await seedOwnerless(kr, 'acct_cc_legacy');
      let afterConcurrent: Awaited<ReturnType<typeof snap>> | undefined;
      const cliFetch = (async (url: unknown) => {
        if (String(url).includes('token')) {
          // Concurrent writer lands first, so the CLI CAS must abort atomically.
          await kr.setSecret('sentropic-llm-mesh:acct_cc_legacy:envelope', JSON.stringify({
            accountId: 'acct_cc_legacy', accessToken: 'ya29.concurrent', refreshToken: '1//concurrent',
            expiresAt: '2099-01-01T00:00:00.000Z', authClientConfigVersion: 'v1.0.0',
          }));
          afterConcurrent = await snap(krDir);
          return json({ access_token: 'ya29.cli-loser', expires_in: 3600 });
        }
        return json({ cloudaicompanionProject: PROJECT });
      }) as typeof fetch;
      expect(await runEnroll(
        { command: 'enroll', provider: 'cloud-code', credentialStdin: true, account: 'acct_cc_legacy', keyringDir: krDir },
        { fetchFn: cliFetch, writers: captureWriters(), env: {}, readAgyToken: async () => PAYLOAD, hostname: FAKE_HOST },
      )).toBe(EXIT_CODES.enrollmentFailed);
      expect(await kr.getSecret('sentropic-llm-mesh:acct_cc_legacy:owner')).toBeNull();
      expect(await snap(krDir)).toEqual(afterConcurrent);
    } finally { await cleanup(); }
  });

  it('commits the accounts:index update inside the same CAS: a concurrent index write aborts create-account without residue', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const krDir = join(dir, 'kr-cas4');
      const kr = new EncryptedFileKeyring(krDir);
      await kr.setSecret('sentropic-llm-mesh:accounts:index', JSON.stringify(['acct_cc_seed']));
      let afterConcurrent: Awaited<ReturnType<typeof snap>> | undefined;
      const cliFetch = (async (url: unknown) => {
        if (String(url).includes('token')) {
          await kr.setSecret('sentropic-llm-mesh:accounts:index', JSON.stringify(['acct_cc_seed', 'acct_cc_other']));
          afterConcurrent = await snap(krDir);
          return json({ access_token: 'ya29.new', expires_in: 3600 });
        }
        return json({ cloudaicompanionProject: PROJECT });
      }) as typeof fetch;
      expect(await runEnroll(
        { command: 'enroll', provider: 'cloud-code', credentialStdin: true, createAccount: true, ownerScope: OWNER, keyringDir: krDir },
        { fetchFn: cliFetch, writers: captureWriters(), env: {}, readAgyToken: async () => PAYLOAD, hostname: FAKE_HOST },
      )).toBe(EXIT_CODES.enrollmentFailed);
      expect(await snap(krDir)).toEqual(afterConcurrent);
      expect(JSON.parse((await kr.getSecret('sentropic-llm-mesh:accounts:index'))!)).toEqual(['acct_cc_seed', 'acct_cc_other']);
    } finally { await cleanup(); }
  });

  it('creates the durable :owner claim for a legacy ownerless account on successful re-enroll', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const krDir = join(dir, 'kr-cas5');
      const kr = new EncryptedFileKeyring(krDir);
      await seedOwnerless(kr, 'acct_cc_legacy_ok');
      const cliFetch = (async (url: unknown) => String(url).includes('token')
        ? json({ access_token: 'ya29.new', expires_in: 3600 })
        : json({ cloudaicompanionProject: PROJECT })) as typeof fetch;
      expect(await runEnroll(
        { command: 'enroll', provider: 'cloud-code', credentialStdin: true, account: 'acct_cc_legacy_ok', keyringDir: krDir },
        { fetchFn: cliFetch, writers: captureWriters(), env: {}, readAgyToken: async () => PAYLOAD, hostname: FAKE_HOST },
      )).toBe(EXIT_CODES.ok);
      expect(JSON.parse((await kr.getSecret('sentropic-llm-mesh:acct_cc_legacy_ok:owner'))!))
        .toEqual({ v: 1, accountId: 'acct_cc_legacy_ok', ownerScopeRef: OWNER });
    } finally { await cleanup(); }
  });
});
