/**
 * Protected file gateway state (L1, spec 6.1/6.2).
 *
 * The adapter owns its layout under an owner-scoped stateDir (0700):
 * gateway-state.enc plus lock/quarantine files at 0600, atomic durable
 * writes, lock ownership, and schema fencing. Ciphertext binds to the mesh
 * keyring key identity under a distinct gateway namespace; no plaintext key
 * sits next to ciphertext. Corruption quarantines with a static error and
 * never resets to an empty store.
 */
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FileGatewayStateStore, sealStateEnvelope } from '../src/node/gateway-state-store.js';
import type { StoredState } from '../src/ports/gateway-state.js';

const dekFor = (seed: string): string =>
  Buffer.from(seed.padEnd(32, seed).slice(0, 32)).toString('hex');

const keyringFor = (dekHex: string) => ({
  getSecret: async () => dekHex,
});

const emptyState = (): StoredState => ({
  schemaVersion: 1,
  revision: 0,
  sessions: {},
  receipts: {},
});

const freshDir = (): string =>
  mkdtempSync(join(tmpdir(), 'gw-state-test-'));

describe('FileGatewayStateStore', () => {
  it('refuses an authenticated snapshot with invalid state namespaces', async () => {
    const { writeFile } = await import('node:fs/promises');
    for (const field of ['sessions', 'receipts', 'affinities']) {
      const dir = freshDir(); const key = dekFor('schema');
      await writeFile(join(dir, 'gateway-state.enc'), sealStateEnvelope(key, { ...emptyState(), [field]: [] }));
      await expect(new FileGatewayStateStore({ stateDir: dir, keyring: keyringFor(key) }).load()).rejects.toMatchObject({ code: 'CORRUPT' });
    }
  });
  it('refuses missing committed ciphertext instead of issuing into a fresh store', async () => {
    const dir = freshDir();
    const options = { stateDir: dir, keyring: keyringFor(dekFor('missing')) };
    await new FileGatewayStateStore(options).compareAndSet(0, { ...emptyState(), revision: 1 });
    await (await import('node:fs/promises')).unlink(join(dir, 'gateway-state.enc'));
    await expect(new FileGatewayStateStore(options).load()).rejects.toMatchObject({ code: 'CORRUPT' });
  });
  it('refuses unavailable keys on an empty store and never steals a live writer by age', async () => {
    const dir = freshDir();
    const locked = new FileGatewayStateStore({ stateDir: dir, keyring: { getSecret: async () => null } });
    await expect(locked.load()).rejects.toMatchObject({ code: 'KEY-UNAVAILABLE' });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, '.lock'), JSON.stringify({ pid: process.pid, token: 'live', startedAt: 0 }));
    const store = new FileGatewayStateStore({ stateDir: dir, keyring: keyringFor(dekFor('a')) });
    await expect(store.compareAndSet(0, { ...emptyState(), revision: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('creates the private layout and round-trips state across instances', async () => {
    const dir = freshDir();
    const first = new FileGatewayStateStore({ stateDir: dir, keyring: keyringFor(dekFor('a')) });
    const loaded = await first.load();
    expect(loaded).toEqual(emptyState());
    await first.compareAndSet(0, { ...emptyState(), revision: 1 });
    const restarted = new FileGatewayStateStore({ stateDir: dir, keyring: keyringFor(dekFor('a')) });
    expect((await restarted.load()).revision).toBe(1);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, 'gateway-state.enc')).mode & 0o777).toBe(0o600);
  });

  it('serializes concurrent writers: one commit wins, the other conflicts', async () => {
    const dir = freshDir();
    const store = new FileGatewayStateStore({ stateDir: dir, keyring: keyringFor(dekFor('b')) });
    await store.compareAndSet(0, { ...emptyState(), revision: 1 });
    const results = await Promise.allSettled([
      store.compareAndSet(0, { ...emptyState(), revision: 1 }),
      store.compareAndSet(1, { ...emptyState(), revision: 2 }),
    ]);
    const codes = results.map((result) =>
      result.status === 'rejected' ? (result.reason as { code?: string }).code : 'ok',
    );
    expect(codes.sort()).toEqual(['CONFLICT', 'ok']);
    expect((await store.load()).revision).toBe(2);
  });

  it('quarantines corruption with a static error and never resets', async () => {
    const dir = freshDir();
    const store = new FileGatewayStateStore({ stateDir: dir, keyring: keyringFor(dekFor('c')) });
    await store.compareAndSet(0, { ...emptyState(), revision: 1 });
    const encPath = join(dir, 'gateway-state.enc');
    const raw = JSON.parse(readFileSync(encPath, 'utf8')) as { data: string };
    raw.data = Buffer.from(raw.data, 'base64').fill(0x41).toString('base64');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(encPath, JSON.stringify(raw));
    await expect(store.load()).rejects.toMatchObject({ code: 'CORRUPT' });
    await expect(store.load()).rejects.toMatchObject({ code: 'CORRUPT' });
    const quarantined = (await import('node:fs/promises')).readdir(dir);
    expect((await quarantined).some((name) => name.startsWith('.quarantine-'))).toBe(true);
  });

  it('refuses a wrong key identity and a schema mismatch as corruption', async () => {
    const dir = freshDir();
    const store = new FileGatewayStateStore({ stateDir: dir, keyring: keyringFor(dekFor('d')) });
    await store.compareAndSet(0, { ...emptyState(), revision: 1 });
    const stranger = new FileGatewayStateStore({ stateDir: dir, keyring: keyringFor(dekFor('e')) });
    await expect(stranger.load()).rejects.toMatchObject({ code: 'CORRUPT' });
    const dir2 = freshDir();
    const writer = new FileGatewayStateStore({ stateDir: dir2, keyring: keyringFor(dekFor('f')) });
    await writer.compareAndSet(0, { ...emptyState(), revision: 1 });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      join(dir2, 'gateway-state.enc'),
      sealStateEnvelope(dekFor('f'), { ...emptyState(), schemaVersion: 99, revision: 1 }),
    );
    await expect(writer.load()).rejects.toMatchObject({ code: 'CORRUPT' });
  });

  it('recovers an abandoned retirement fence left by a crashed retirer for both lock kinds', async () => {
    const { writeFile, readFile } = await import('node:fs/promises');
    for (const name of ['.host-lock', '.lock']) {
      const dir = freshDir();
      const staleToken = `dead-token-${name === '.host-lock' ? 'h' : 't'}`;
      await writeFile(join(dir, name), JSON.stringify({ pid: 999_999_999, token: staleToken, startedAt: 1 }), { mode: 0o600 });
      await writeFile(join(dir, `${name}.retire-${staleToken}`), JSON.stringify({ pid: 999_999_998, token: 'crashed', startedAt: 1 }), { mode: 0o600 });
      const store = new FileGatewayStateStore({ stateDir: dir, keyring: keyringFor(dekFor('r')) });
      if (name === '.host-lock') {
        const release = await store.claimWriter();
        const held = JSON.parse(await readFile(join(dir, name), 'utf8')) as { pid: number };
        expect(held.pid).toBe(process.pid);
        await release();
      } else {
        await store.compareAndSet(0, { ...emptyState(), revision: 1 });
        expect((await store.load()).revision).toBe(1);
      }
    }
  });
  it('keeps a live retirement fence blocking while a dead fence is reclaimed', async () => {
    const { writeFile } = await import('node:fs/promises');
    const dir = freshDir();
    await writeFile(join(dir, '.host-lock'), JSON.stringify({ pid: 999_999_999, token: 'dead-live', startedAt: 1 }), { mode: 0o600 });
    await writeFile(join(dir, '.host-lock.retire-dead-live'), JSON.stringify({ pid: process.pid, token: 'live', startedAt: 1 }), { mode: 0o600 });
    await expect(new FileGatewayStateStore({ stateDir: dir, keyring: keyringFor(dekFor('r')) }).claimWriter()).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('fences stale-lock takeover so two contenders cannot both claim writer ownership', async () => {
    const { writeFile, readFile } = await import('node:fs/promises');
    for (let round = 0; round < 15; round += 1) {
      const dir = freshDir();
      const lockPath = join(dir, '.host-lock');
      await writeFile(lockPath, JSON.stringify({ pid: 999_999_999, token: `dead-${round}`, startedAt: 1 }), { mode: 0o600 });
      const stores = Array.from({ length: 16 }, () => new FileGatewayStateStore({ stateDir: dir, keyring: keyringFor(dekFor('g')) }));
      const launches = stores.map(async (s, idx) => {
        if (idx >= 4) {
          await Promise.all(Array.from({ length: idx * 2 }, () => readFile(lockPath, 'utf8').catch(() => undefined)));
        }
        return s.claimWriter();
      });
      const results = await Promise.allSettled(launches);
      const fulfilled = results.filter((r): r is PromiseFulfilledResult<() => Promise<void>> => r.status === 'fulfilled');
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(stores.length - 1);
      for (const r of rejected) expect(r.reason).toMatchObject({ code: 'CONFLICT' });
      const heldAfterRace = JSON.parse(await readFile(lockPath, 'utf8')) as { pid: number; token: string };
      expect(heldAfterRace.pid).toBe(process.pid);
      expect(heldAfterRace.token).not.toBe(`dead-${round}`);
      await fulfilled[0]!.value();
    }
  });
});
