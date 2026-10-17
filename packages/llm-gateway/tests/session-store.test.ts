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
});
