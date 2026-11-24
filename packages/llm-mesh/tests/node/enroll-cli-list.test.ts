// Read-only `llm-mesh-enroll list`: discovers accountId/ownerScopeRef from
// :public and :owner only, never reads :envelope, never writes. Fakes only.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT_CODES, parseArgs } from '../../src/node/cli/enroll-args.js';
import { run } from '../../src/node/cli/enroll-cli.js';
import { deriveKeyringMasterKey, EncryptedFileKeyring } from '../../src/node/keyring/encrypted-file-keyring.js';
import { allOutput, captureWriters, KEY_ENV, PASSPHRASE, tempDir } from './enroll-cli-testkit.js';

const OWNER = 'team:prod-owner';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const snap = async (dir: string) => {
  const files: Record<string, { bytes: Buffer; mode: number; mtimeMs: number }> = {};
  for (const name of (await readdir(dir)).sort()) {
    const st = await stat(join(dir, name));
    files[name] = { bytes: await readFile(join(dir, name)), mode: st.mode & 0o777, mtimeMs: st.mtimeMs };
  }
  return { dirMode: (await stat(dir)).mode & 0o777, files };
};

interface SeedOpts {
  providerId?: string;
  status?: string;
  publicOwner?: string;
  claimOwner?: string;
  removed?: boolean;
  misbound?: boolean;
  withEnvelope?: boolean;
  metadata?: Record<string, unknown>;
}

const seedListAccount = async (kr: EncryptedFileKeyring, id: string, opts: SeedOpts = {}) => {
  const providerId = opts.providerId ?? 'cloud-code';
  const status = opts.status ?? 'active';
  if (opts.withEnvelope !== false) {
    await kr.setSecret(`sentropic-llm-mesh:${id}:envelope`, JSON.stringify({
      accountId: id, accessToken: `ya29.list-secret-${id}`, refreshToken: `1//list-secret-${id}`,
      expiresAt: '2099-01-01T00:00:00.000Z', authClientConfigVersion: 'v1.0.0',
    }));
  }
  await kr.setSecret(`sentropic-llm-mesh:${id}:public`, JSON.stringify({
    accountId: opts.misbound ? 'acct_someone_else' : id, accountLabel: 'Seat', providerId, status,
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
    account: {
      accountId: id, ownerScopeRef: opts.publicOwner ?? OWNER, accountLabel: 'Seat',
      targetProviderId: providerId === 'cloud-code' ? 'gemini' : providerId,
      transportProviderId: providerId, status, metadata: opts.metadata ?? {},
    },
  }));
  if (opts.claimOwner !== undefined) {
    await kr.setSecret(`sentropic-llm-mesh:${id}:owner`, JSON.stringify({ v: 1, accountId: id, ownerScopeRef: opts.claimOwner }));
  }
  if (opts.removed) {
    await kr.setSecret(`sentropic-llm-mesh:${id}:removed`, JSON.stringify({
      v: 1, accountId: id, ownerScopeRef: opts.publicOwner ?? OWNER, removedAt: '2026-11-11T00:00:00.000Z',
    }));
  }
};

describe('llm-mesh-enroll list (read-only account discovery)', () => {
  it('parses the list command and requires --keyring-dir', async () => {
    expect(parseArgs(['list', '--keyring-dir', '/tmp/kr']).command).toBe('list');
    const writers = captureWriters();
    expect(await run(['list'], { writers, env: {} })).toBe(EXIT_CODES.usage);
  });

  it('emits one secret-free line per active/reauth account without reading :envelope or writing', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const krDir = join(dir, 'kr-list');
      const kr = new EncryptedFileKeyring(krDir, deriveKeyringMasterKey(PASSPHRASE));
      await seedListAccount(kr, 'acct_cc_live', {
        claimOwner: OWNER,
        metadata: { cloudaicompanionProject: 'aicode-consumers', cloudCodeTier: 'g1-ultra-tier' },
      });
      // No :envelope at all: listing must still succeed for this account.
      await seedListAccount(kr, 'acct_cc_reauth', { status: 'reauth_required', claimOwner: OWNER, withEnvelope: false });
      await seedListAccount(kr, 'acct_cc_claim', { claimOwner: 'team:durable-owner', publicOwner: 'team:stale-public' });
      await seedListAccount(kr, 'acct_muse_1', { providerId: 'muse', claimOwner: OWNER });
      await seedListAccount(kr, 'acct_cc_removed', { removed: true, claimOwner: OWNER });
      await seedListAccount(kr, 'acct_cc_disabled', { status: 'disabled', claimOwner: OWNER });
      await seedListAccount(kr, 'acct_cc_misbound', { misbound: true, claimOwner: OWNER });
      await kr.setSecret('sentropic-llm-mesh:accounts:index', JSON.stringify([
        'acct_cc_live', 'acct_cc_reauth', 'acct_cc_claim', 'acct_muse_1',
        'acct_cc_removed', 'acct_cc_disabled', 'acct_cc_misbound', 'acct_missing',
      ]));
      await sleep(25);
      const before = await snap(krDir);

      const writers = captureWriters();
      const code = await run(
        ['list', '--keyring-dir', krDir, '--keyring-key-env', KEY_ENV],
        { writers, env: { [KEY_ENV]: PASSPHRASE } },
      );
      expect(code).toBe(EXIT_CODES.ok);
      const lines = writers.outLines.map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(lines.map((l) => l.accountId)).toEqual(['acct_cc_live', 'acct_cc_reauth', 'acct_cc_claim', 'acct_muse_1']);
      expect(lines[0]).toEqual({
        accountId: 'acct_cc_live', providerId: 'cloud-code', status: 'active',
        ownerScopeRef: OWNER, updatedAt: '2026-11-10T00:00:00.000Z',
        project: 'aicode-consumers', tier: 'g1-ultra-tier',
      });
      expect(lines[1]?.status).toBe('reauth_required');
      expect(lines[2]?.ownerScopeRef).toBe('team:durable-owner');
      expect(lines[3]?.providerId).toBe('muse');
      expect(lines[3]).not.toHaveProperty('project');
      expect(allOutput(writers)).not.toContain('list-secret');
      expect(await snap(krDir)).toEqual(before);
    } finally { await cleanup(); }
  });

  it('works with a .key keyring, and on a missing directory emits nothing and creates nothing', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const krDir = join(dir, 'kr-file');
      const kr = new EncryptedFileKeyring(krDir);
      await seedListAccount(kr, 'acct_cc_file', { claimOwner: OWNER });
      await kr.setSecret('sentropic-llm-mesh:accounts:index', JSON.stringify(['acct_cc_file']));
      const writers = captureWriters();
      expect(await run(['list', '--keyring-dir', krDir], { writers, env: {} })).toBe(EXIT_CODES.ok);
      expect(writers.outLines.map((l) => (JSON.parse(l) as { accountId: string }).accountId)).toEqual(['acct_cc_file']);

      const missingDir = join(dir, 'kr-missing');
      const empty = captureWriters();
      expect(await run(['list', '--keyring-dir', missingDir, '--keyring-key-env', KEY_ENV],
        { writers: empty, env: { [KEY_ENV]: PASSPHRASE } })).toBe(EXIT_CODES.ok);
      expect(empty.outLines).toEqual([]);
      await expect(stat(missingDir)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await cleanup(); }
  });
});
