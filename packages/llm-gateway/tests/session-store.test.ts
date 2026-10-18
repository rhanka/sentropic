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

  it('prevents a delayed recovery contender from deleting a live successor fence or admitting two writers (Sol r3 repro)', async () => {
    const fsPromises = await import('node:fs/promises');
    const { AsyncLocalStorage } = await import('node:async_hooks');
    const als = new AsyncLocalStorage<'A' | 'B'>();
    const gate = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; };
    for (const name of ['.host-lock', '.lock'] as const) {
      const dir = freshDir(); const primary = join(dir, name); const fence = `${primary}.retire-dead`;
      await fsPromises.writeFile(primary, JSON.stringify({ pid: 999_999_999, token: 'dead', startedAt: 1 }), { mode: 0o600 });
      await fsPromises.writeFile(fence, JSON.stringify({ pid: 999_999_998, token: 'retirer', startedAt: 1 }), { mode: 0o600 });
      const readers = new Set<'A' | 'B'>();
      const bothRead = gate(); const aVerified = gate(); const bFinished = gate();
      let successorFenceDeleted = false;
      const fsOps = {
        ...fsPromises,
        readFile: (async (path: Parameters<typeof fsPromises.readFile>[0], ...rest: unknown[]) => {
          const raw = await (fsPromises.readFile as (...args: unknown[]) => Promise<string>)(path, ...rest);
          const label = als.getStore();
          if (!label) return raw;
          if (path === fence && !readers.has(label)) {
            readers.add(label); if (readers.size === 2) bothRead.resolve();
            await bothRead.promise; if (label === 'B') await aVerified.promise;
          } else if (path === primary && label === 'A' && readers.has('A')) {
            aVerified.resolve(); await bFinished.promise;
          }
          return raw;
        }) as typeof fsPromises.readFile,
        unlink: (async (path: Parameters<typeof fsPromises.unlink>[0]) => {
          if (als.getStore() === 'B' && String(path).startsWith(`${primary}.retire-`)) successorFenceDeleted = true;
          return fsPromises.unlink(path);
        }) as typeof fsPromises.unlink,
      };
      const storeA = new FileGatewayStateStore({ stateDir: dir, keyring: keyringFor(dekFor('s')), fsOps });
      const storeB = new FileGatewayStateStore({ stateDir: dir, keyring: keyringFor(dekFor('s')), fsOps });
      const runContender = (label: 'A' | 'B', store: FileGatewayStateStore) => als.run(label, async () => {
        try {
          if (name === '.host-lock') return await store.claimWriter();
          await store.compareAndSet(0, { ...emptyState(), revision: 1 });
          return async () => undefined;
        } finally { if (label === 'B') bFinished.resolve(); }
      });
      const results = await Promise.allSettled([runContender('A', storeA), runContender('B', storeB)]);
      expect(successorFenceDeleted, name).toBe(false);
      expect(results[0]?.status, name).toBe('fulfilled');
      expect(results[1]?.status, name).toBe('rejected');
      if (results[1]?.status === 'rejected') expect(results[1].reason).toMatchObject({ code: 'CONFLICT' });
      if (results[0]?.status === 'fulfilled') await results[0].value();
    }
  });

  it('recovers safely under competing contenders when a pre-existing retirement fence is incomplete or malformed', async () => {
    const { writeFile } = await import('node:fs/promises');
    for (const name of ['.host-lock', '.lock'] as const) {
      for (const badBytes of ['', '{"pid":', 'corrupt-fence-bytes']) {
        const dir = freshDir(); const primary = join(dir, name);
        await writeFile(primary, JSON.stringify({ pid: 999_999_999, token: 'dead-inc', startedAt: 1 }), { mode: 0o600 });
        await writeFile(`${primary}.retire-dead-inc`, badBytes, { mode: 0o600 });
        const stores = [0, 1, 2].map(() => new FileGatewayStateStore({ stateDir: dir, keyring: keyringFor(dekFor('m')) }));
        const results = await Promise.allSettled(stores.map((s) =>
          name === '.host-lock' ? s.claimWriter() : s.compareAndSet(0, { ...emptyState(), revision: 1 }).then(() => async () => undefined)));
        const fulfilled = results.filter((r): r is PromiseFulfilledResult<() => Promise<void>> => r.status === 'fulfilled');
        const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(fulfilled, `${name}:${badBytes}`).toHaveLength(1);
        expect(rejected, `${name}:${badBytes}`).toHaveLength(2);
        for (const r of rejected) expect(r.reason).toMatchObject({ code: 'CONFLICT' });
        await fulfilled[0]!.value();
      }
    }
  });

  it('maintains liveness across SIGKILL of a live holder, W1/W2/W3 crash windows, and >32 repeated recovery crashes', async () => {
    const { spawn } = await import('node:child_process');
    const { readdir, writeFile } = await import('node:fs/promises');
    const modDir = freshDir();
    const copyTs = (rel: string, out: string) =>
      writeFile(join(modDir, out), readFileSync(new URL(rel, import.meta.url), 'utf8').replace('../ports/gateway-state.js', './gateway-state.ts'));
    await Promise.all([copyTs('../src/ports/gateway-state.ts', 'gateway-state.ts'), copyTs('../src/node/gateway-state-store.ts', 'gateway-state-store.ts')]);
    const spawnCrashChild = async (script: string, marker = 'READY', ...nodeArgs: string[]): Promise<number> => {
      const child = spawn(process.execPath, [...nodeArgs, '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, sig) => reject(new Error(`child exited before ${marker} (${code ?? sig})`)));
        child.stdout.on('data', (chunk: Buffer) => { if (chunk.toString().includes(marker)) resolve(); });
      });
      const pid = child.pid!; child.kill('SIGKILL');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
      return pid;
    };
    for (const name of ['.host-lock', '.lock'] as const) {
      for (const window of ['LIVE', 'W1', 'W2', 'W3'] as const) {
        const dir = freshDir(); const primary = join(dir, name);
        if (window === 'LIVE') {
          await spawnCrashChild(`const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(primary)}, JSON.stringify({ pid: process.pid, token: 'live-killed', startedAt: Date.now() }), { mode: 0o600 }); process.stdout.write('READY\\n'); setInterval(() => {}, 1000);`);
        } else if (window === 'W1') {
          await writeFile(primary, JSON.stringify({ pid: 999_999_999, token: 'stale-w1', startedAt: 1 }), { mode: 0o600 });
          await spawnCrashChild(`const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(`${primary}.retire-stale-w1`)}, JSON.stringify({ pid: process.pid, token: 'w1-fence', startedAt: Date.now() }), { mode: 0o600 }); process.stdout.write('READY\\n'); setInterval(() => {}, 1000);`);
        } else if (window === 'W2') {
          await writeFile(primary, JSON.stringify({ pid: 999_999_999, token: 'stale-w2', startedAt: 1 }), { mode: 0o600 });
          await spawnCrashChild(`const fs = require('node:fs'); const claim = JSON.stringify({ pid: process.pid, token: 'w2-claim', startedAt: Date.now() }); fs.writeFileSync(${JSON.stringify(`${primary}.retire-stale-w2`)}, claim, { mode: 0o600 }); fs.writeFileSync(${JSON.stringify(primary)} + '.' + process.pid + '.w2-claim.claim', claim, { mode: 0o600 }); process.stdout.write('READY\\n'); setInterval(() => {}, 1000);`);
        } else {
          await spawnCrashChild(`const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(`${primary}.retire-old-w3`)}, JSON.stringify({ pid: process.pid, token: 'w3-fence', startedAt: Date.now() }), { mode: 0o600 }); fs.writeFileSync(${JSON.stringify(primary)}, JSON.stringify({ pid: process.pid, token: 'w3-new', startedAt: Date.now() }), { mode: 0o600 }); process.stdout.write('READY\\n'); setInterval(() => {}, 1000);`);
        }
        const stores = [0, 1, 2].map(() => new FileGatewayStateStore({ stateDir: dir, keyring: keyringFor(dekFor('l')) }));
        const results = await Promise.allSettled(stores.map((s) =>
          name === '.host-lock' ? s.claimWriter() : s.compareAndSet(0, { ...emptyState(), revision: 1 }).then(() => async () => undefined)));
        const fulfilled = results.filter((r): r is PromiseFulfilledResult<() => Promise<void>> => r.status === 'fulfilled');
        expect(fulfilled, `${name}:${window}`).toHaveLength(1);
        await fulfilled[0]!.value();
        const remaining = await readdir(dir);
        expect(remaining.filter((f) => f.startsWith(`${name}.retire-`)), `${name}:${window}`).toEqual([]);
      }
      const chainDir = freshDir();
      await writeFile(join(chainDir, name), JSON.stringify({ pid: 999_999_999, token: 'dead-root', startedAt: 1 }), { mode: 0o600 });
      const killedPids: number[] = [];
      for (let i = 0; i < 36; i += 1) {
        const script = `import * as fs from 'node:fs/promises'; import { FileGatewayStateStore } from ${JSON.stringify(join(modDir, 'gateway-state-store.ts'))};
          const store = new FileGatewayStateStore({ stateDir: ${JSON.stringify(chainDir)}, keyring: { getSecret: async () => ${JSON.stringify(dekFor('l'))} }, fsOps: { link: async (s, d) => { await fs.link(s, d); if (String(d).includes('.retire-')) { setInterval(() => {}, 1000); process.stdout.write('FENCE_READY\\n'); await new Promise(() => {}); } } } });
          ${name === '.host-lock' ? 'await store.claimWriter();' : 'await store.compareAndSet(0, { schemaVersion: 1, revision: 1, sessions: {}, receipts: {} });'}`;
        killedPids.push(await spawnCrashChild(script, 'FENCE_READY', '--disable-warning=ExperimentalWarning', '--input-type=module'));
      }
      expect(killedPids.every((pid) => { try { process.kill(pid, 0); return false; } catch { return true; } }), name).toBe(true);
      expect((await readdir(chainDir)).filter((f) => f.startsWith(`${name}.retire-`)), name).toHaveLength(36);
      const stores = [0, 1, 2].map(() => new FileGatewayStateStore({ stateDir: chainDir, keyring: keyringFor(dekFor('l')) }));
      const results = await Promise.allSettled(stores.map((s) =>
        name === '.host-lock' ? s.claimWriter() : s.compareAndSet(0, { ...emptyState(), revision: 1 }).then(() => async () => undefined)));
      const fulfilled = results.filter((r): r is PromiseFulfilledResult<() => Promise<void>> => r.status === 'fulfilled');
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(fulfilled, `${name}:chain36`).toHaveLength(1);
      expect(rejected, `${name}:chain36`).toHaveLength(2);
      for (const r of rejected) expect(r.reason).toMatchObject({ code: 'CONFLICT' });
      await fulfilled[0]!.value();
      expect((await readdir(chainDir)).filter((f) => f.startsWith(`${name}.retire-`) || f.endsWith('.claim')), name).toEqual([]);
    }
  }, 30_000);
});
