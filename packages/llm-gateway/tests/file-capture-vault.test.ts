import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_CAPTURE_RETENTION_MS, TEN_JULIAN_YEAR_MS, computeCaptureRetentionDeadline,
} from '../src/ports/capture-vault.js';
import { FileCaptureVault } from '../src/node/file-capture-vault.js';
import { GuardEngine } from '../src/guards/guard-engine.js';
import { ControlServer, createInProcessControlTransport } from '../src/node/control-server.js';
import { createGatewayControlClient } from '../src/node/control-client.js';
import { GatewaySessionService } from '../src/session-service.js';
import type { GatewayStateStore, StoredState } from '../src/ports/gateway-state.js';

const DEK_V1 = 'a'.repeat(64);
const DEK_V2 = 'b'.repeat(64);
const keyring = {
  async getSecret(key: string) {
    if (key.endsWith('/v2')) return DEK_V2;
    return DEK_V1;
  },
};
const memStore: GatewayStateStore = {
  load: async (): Promise<StoredState> => ({ schemaVersion: 1, revision: 0, sessions: {}, receipts: {} }),
  compareAndSet: async (_e, n) => ({ revision: n.revision }),
};

describe('L1.4 FileCaptureVault (default-OFF, deflate+AES-256-GCM+AAD, 30d purge, 512 MiB quota, control.sock read)', () => {
  it('computes pure capture retention deadlines (30d default, none, 10y cap) and defaults captureEnabled=false', async () => {
    expect(DEFAULT_CAPTURE_RETENTION_MS).toBe(2_592_000_000);
    expect(computeCaptureRetentionDeadline({ kind: 'none' }, 1_000)).toBeNull();
    expect(computeCaptureRetentionDeadline({ kind: 'finite', durationMs: DEFAULT_CAPTURE_RETENTION_MS }, 1_000))
      .toBe(1_000 + 2_592_000_000);
    expect(() => computeCaptureRetentionDeadline({ kind: 'finite', durationMs: TEN_JULIAN_YEAR_MS + 1 }, 1_000)).toThrow();

    const dir = await mkdtemp(join(tmpdir(), 'gw-vault-off-'));
    try {
      const vault = new FileCaptureVault({ stateDir: dir, keyring });
      expect(vault.enabled).toBe(false);
      const guard = new GuardEngine();
      const res = await vault.writeTurnCapture({
        stageId: 'wkst:1', ownerScopeRef: 'owner-a', requestId: 'r1', wire: 'anthropic-messages', model: 'claude-sonnet-5',
        requestCapture: guard.maskForCapture({ messages: [{ role: 'user', content: 'secret alice@example.org' }] }),
        responseCapture: guard.maskForCapture({ text: 'ok' }),
      });
      expect(res).toEqual({ stored: false, reason: 'capture_disabled' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('encrypts deflated masked bodies with 0600 mode, keyId rotation, AAD binding, owner-only control.sock read, quota & 30d purge', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gw-vault-on-'));
    try {
      const guard = new GuardEngine();
      let now = 1_700_000_000_000;
      const vault = new FileCaptureVault({
        stateDir: dir, keyring, captureEnabled: true, keyId: 'v1', now: () => now,
      });
      const reqCap = guard.maskForCapture({ messages: [{ role: 'user', content: 'hello alice@example.org' }] });
      const respCap = guard.maskForCapture({ text: 'world ' + 'Z'.repeat(200) });
      const written = await vault.writeTurnCapture({
        captureId: 'cap-1', stageId: 'wkst:1', ownerScopeRef: 'owner-a', requestId: 'req-1',
        wire: 'anthropic-messages', model: 'claude-sonnet-5', requestCapture: reqCap, responseCapture: respCap,
      });
      expect(written.stored).toBe(true);
      expect(written.expiresAtMs).toBe(now + DEFAULT_CAPTURE_RETENTION_MS);

      // Raw disk file is 0600 ciphertext containing zero plaintext email or response text
      const filePath = join(dir, 'captures', 'cap-1.enc.json');
      expect((await stat(filePath)).mode & 0o777).toBe(0o600);
      const rawDisk = await readFile(filePath, 'utf8');
      expect(rawDisk).not.toContain('alice@example.org');
      expect(rawDisk).not.toContain('ZZZZZZZZ');
      expect(rawDisk).toContain('"keyId":"v1"');

      // Owner-only audited read over ControlServer (control.sock contract)
      const controlToken = 'control-token-vault-test-0123456789';
      const control = new ControlServer({ service: new GatewaySessionService(memStore), controlToken, ownerScopeRef: 'owner-a', captureVault: vault });
      const client = createGatewayControlClient({ transport: createInProcessControlTransport(control), token: controlToken });
      const loaded = await client.readTurnCapture({ ownerScopeRef: 'owner-a', captureId: 'cap-1' });
      expect(loaded.captureId).toBe('cap-1');
      expect(JSON.stringify(loaded.requestCapture.payload)).toContain('[REDACTED:EMAIL]');
      expect(await readFile(join(dir, 'captures', 'read-audit.jsonl'), 'utf8')).toContain('"outcome":"ok"');

      // Cross-owner read fails closed
      await expect(vault.readTurnCapture({ ownerScopeRef: 'owner-b', captureId: 'cap-1' })).rejects.toMatchObject({ code: 'ACCESS-DENIED' });

      // Tampered AAD fails closed
      const parsed = JSON.parse(rawDisk) as Record<string, unknown>;
      parsed.stageId = 'wkst:tampered';
      await writeFile(filePath, JSON.stringify(parsed), { mode: 0o600 });
      await expect(vault.readTurnCapture({ ownerScopeRef: 'owner-a', captureId: 'cap-1' })).rejects.toMatchObject({ code: 'CORRUPT' });
      await writeFile(filePath, rawDisk, { mode: 0o600 });

      // Quota evicts expired blobs first; dated purge reaps expired blobs
      const quotaVault = new FileCaptureVault({
        stateDir: dir, keyring, captureEnabled: true, keyId: 'v2', quotaBytes: rawDisk.length + 50, now: () => now,
      });
      // Not expired yet -> quota exceeded (non-fatal)
      const over = await quotaVault.writeTurnCapture({
        captureId: 'cap-2', stageId: 'wkst:1', ownerScopeRef: 'owner-a', requestId: 'req-2',
        wire: 'anthropic-messages', model: 'claude-sonnet-5', requestCapture: reqCap, responseCapture: respCap,
      });
      expect(over).toEqual({ stored: false, reason: 'capture_quota_exceeded' });
      // Advance past 30 days -> expired cap-1 evicted, cap-2 stores cleanly
      now += DEFAULT_CAPTURE_RETENTION_MS + 1;
      const afterEvict = await quotaVault.writeTurnCapture({
        captureId: 'cap-2', stageId: 'wkst:1', ownerScopeRef: 'owner-a', requestId: 'req-2',
        wire: 'anthropic-messages', model: 'claude-sonnet-5', requestCapture: reqCap, responseCapture: respCap,
      });
      expect(afterEvict.stored).toBe(true);
      // Dated purge receipt after cap-2 expires
      now += DEFAULT_CAPTURE_RETENTION_MS + 1;
      const purged = await quotaVault.purgeExpiredCaptures(now);
      expect(purged.purgedCount).toBe(1);
      expect(purged.purgedCaptureIds).toEqual(['cap-2']);
      expect(purged.purgedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
