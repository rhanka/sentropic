/**
 * Protected file gateway state (L1, spec 6.1/6.2).
 *
 * Owns its layout under an owner-scoped absolute stateDir: directory 0700,
 * `gateway-state.enc` plus lock/quarantine files at 0600 from creation, lock
 * ownership with stale takeover, atomic replace with durable acknowledgement.
 * Ciphertext binds to the mesh keyring key identity under a distinct gateway
 * namespace (AAD); no plaintext key sits next to ciphertext. Missing/wrong
 * key identity, schema mismatch, or corrupt data quarantines with a static
 * error and never resets to an empty store.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import {
  GatewayStateError,
  type GatewayStateStore,
  type StoredState,
} from '../ports/gateway-state.js';

const STATE_FILE = 'gateway-state.enc';
const INITIALIZED_FILE = '.initialized';
const LOCK_FILE = '.lock';
const AAD = 'gateway-state/v1';
const STATE_SCHEMA = 1;

export interface KeyringReader {
  getSecret(key: string): Promise<string | null>;
}

export interface FileStoreOptions {
  readonly stateDir: string;
  readonly keyring: KeyringReader;
  readonly dekKey?: string;
}

interface Envelope {
  readonly v: number;
  readonly iv: string;
  readonly tag: string;
  readonly data: string;
}

const corrupt = (detail: string): GatewayStateError =>
  new GatewayStateError(`gateway state corrupt (quarantined): ${detail}`, 'CORRUPT');

const isCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && 'code' in error
  && (error as { code?: unknown }).code === code;

/** Seal committed state for `gateway-state.enc` (unit-testable envelope). */
export const sealStateEnvelope = (dekHex: string, state: StoredState): string => {
  const dek = Buffer.from(dekHex, 'hex');
  if (dek.length !== 32) throw corrupt('bad key length');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(Buffer.from(AAD, 'utf8'));
  const data = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(state), 'utf8')),
    cipher.final(),
  ]);
  const envelope: Envelope = {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
  return JSON.stringify(envelope);
};

const unsealStateEnvelope = (dekHex: string, raw: string): StoredState => {
  const dek = Buffer.from(dekHex, 'hex');
  if (dek.length !== 32) throw corrupt('bad key length');
  let envelope: Envelope;
  try {
    envelope = JSON.parse(raw) as Envelope;
    if (
      envelope.v !== 1 || typeof envelope.iv !== 'string'
      || typeof envelope.tag !== 'string' || typeof envelope.data !== 'string'
    ) {
      throw new Error('bad envelope');
    }
  } catch {
    throw corrupt('unreadable envelope');
  }
  let plain: string;
  try {
    const decipher = createDecipheriv('aes-256-gcm', dek, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(AAD, 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw corrupt('authentication failed');
  }
  let state: StoredState;
  try {
    state = JSON.parse(plain) as StoredState;
  } catch {
    throw corrupt('unreadable state JSON');
  }
  if (
    !state || state.schemaVersion !== STATE_SCHEMA
    || !Number.isSafeInteger(state.revision) || state.revision < 0
    || typeof state.sessions !== 'object' || state.sessions === null
    || typeof state.receipts !== 'object' || state.receipts === null
    || Array.isArray(state.sessions) || Array.isArray(state.receipts)
    || (state.affinities !== undefined && (!state.affinities || typeof state.affinities !== 'object' || Array.isArray(state.affinities)))
  ) {
    throw corrupt('schema mismatch');
  }
  return state;
};

const emptyState = (): StoredState => ({
  schemaVersion: STATE_SCHEMA,
  revision: 0,
  sessions: {},
  receipts: {},
});

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isCode(error, 'ESRCH');
  }
};

export class FileGatewayStateStore implements GatewayStateStore {
  private readonly stateDir: string;
  private readonly keyring: KeyringReader;
  private readonly dekKey: string;
  private transaction: Promise<unknown> = Promise.resolve();
  private dekCache: string | null = null;

  constructor(options: FileStoreOptions) {
    if (!options.stateDir || !options.stateDir.startsWith('/')) {
      throw new GatewayStateError('stateDir must be an absolute path', 'STORE-FAILED');
    }
    this.stateDir = options.stateDir;
    this.keyring = options.keyring;
    this.dekKey = options.dekKey ?? 'gateway/state-dek';
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    await chmod(this.stateDir, 0o700);
  }

  private async dek(): Promise<string> {
    if (this.dekCache) return this.dekCache;
    const secret = await this.keyring.getSecret(this.dekKey);
    if (!secret || !/^[0-9a-f]{64}$/i.test(secret)) {
      throw new GatewayStateError('gateway key identity unavailable', 'KEY-UNAVAILABLE');
    }
    this.dekCache = secret;
    return secret;
  }

  private async quarantine(detail: string): Promise<void> {
    const notice = join(this.stateDir, `.quarantine-${Date.now()}-${randomBytes(4).toString('hex')}.json`);
    await writeFile(notice, JSON.stringify({ error: detail, at: new Date().toISOString() }), {
      flag: 'wx',
      mode: 0o600,
    });
  }

  private async readRaw(): Promise<StoredState> {
    await this.ensureDir();
    let raw: string;
    try {
      raw = await readFile(join(this.stateDir, STATE_FILE), 'utf8');
    } catch (error) {
      if (isCode(error, 'ENOENT')) {
        try { await readFile(join(this.stateDir, INITIALIZED_FILE)); }
        catch (markerError) {
          if (isCode(markerError, 'ENOENT')) return emptyState();
          throw new GatewayStateError('state initialization evidence unreadable', 'STORE-FAILED');
        }
        throw corrupt('committed state missing');
      }
      throw new GatewayStateError('state file unreadable', 'STORE-FAILED');
    }
    try {
      const state = unsealStateEnvelope(await this.dek(), raw);
      await this.markInitialized();
      return state;
    } catch (error) {
      if (error instanceof GatewayStateError && error.code === 'CORRUPT') {
        await this.quarantine(error.message);
      }
      throw error;
    }
  }

  async load(): Promise<StoredState> {
    await this.dek();
    return this.readRaw();
  }

  private async markInitialized(): Promise<void> {
    let handle;
    try { handle = await open(join(this.stateDir, INITIALIZED_FILE), 'wx', 0o600); }
    catch (error) {
      if (!isCode(error, 'EEXIST')) throw new GatewayStateError('state initialization evidence unavailable', 'STORE-FAILED');
      if (await readFile(join(this.stateDir, INITIALIZED_FILE), 'utf8') !== 'gateway-state/v1\n') throw corrupt('initialization evidence invalid');
      return;
    }
    try { await handle.writeFile('gateway-state/v1\n'); await handle.sync(); } finally { await handle.close(); }
    const directory = await open(this.stateDir, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }

  private async acquireLock(name = LOCK_FILE): Promise<string> {
    const path = join(this.stateDir, name);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomBytes(8).toString('hex');
      const claim = JSON.stringify({ pid: process.pid, token, startedAt: Date.now() });
      try {
        await writeFile(path, claim, { flag: 'wx', mode: 0o600 });
        return token;
      } catch (error) {
        if (!isCode(error, 'EEXIST')) {
          throw new GatewayStateError('lock claim failed', 'STORE-FAILED');
        }
      }
      let held = '{}';
      try {
        held = await readFile(path, 'utf8');
      } catch (error) {
        if (isCode(error, 'ENOENT')) continue;
        throw new GatewayStateError('lock claim failed', 'STORE-FAILED');
      }
      let parsed: { pid?: unknown; token?: unknown };
      try { parsed = JSON.parse(held) as { pid?: unknown; token?: unknown }; } catch { throw corrupt('unreadable lock'); }
      const pid = parsed.pid;
      const staleToken = typeof parsed.token === 'string' && parsed.token.length > 0 ? parsed.token : '';
      if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) throw corrupt('invalid lock owner');
      if (pidAlive(pid)) throw new GatewayStateError('state store locked by a live writer', 'CONFLICT');
      const fenceKey = (staleToken || String(pid)).replace(/[^a-zA-Z0-9_-]/g, '_');
      const fencePath = join(this.stateDir, `${name}.retire-${fenceKey}`);
      try {
        await writeFile(fencePath, claim, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (!isCode(error, 'EEXIST')) {
          throw new GatewayStateError('lock claim failed', 'STORE-FAILED');
        }
        let fenceRaw = '';
        try {
          fenceRaw = await readFile(fencePath, 'utf8');
        } catch (readError) {
          if (isCode(readError, 'ENOENT')) continue;
          throw new GatewayStateError('lock claim failed', 'STORE-FAILED');
        }
        let fencePid: unknown;
        try { fencePid = (JSON.parse(fenceRaw) as { pid?: unknown }).pid; } catch { fencePid = undefined; }
        if (typeof fencePid === 'number' && Number.isSafeInteger(fencePid) && fencePid > 0 && pidAlive(fencePid)) {
          throw new GatewayStateError('state store locked by a live writer', 'CONFLICT');
        }
        await unlink(fencePath).catch(() => undefined);
        const currentRaw = await readFile(path, 'utf8').catch(() => '');
        if (currentRaw !== held) {
          throw new GatewayStateError('state store locked by a live writer', 'CONFLICT');
        }
        continue;
      }
      try {
        const currentRaw = await readFile(path, 'utf8').catch(() => '');
        if (currentRaw !== held) {
          throw new GatewayStateError('state store locked by a live writer', 'CONFLICT');
        }
        const claimPath = `${path}.${token}.claim`;
        await writeFile(claimPath, claim, { flag: 'wx', mode: 0o600 });
        await rename(claimPath, path);
        return token;
      } finally {
        await unlink(fencePath).catch(() => undefined);
      }
    }
    throw new GatewayStateError('state store locked by a live writer', 'CONFLICT');
  }

  private async releaseLock(token: string, name = LOCK_FILE): Promise<void> {
    const path = join(this.stateDir, name);
    try {
      const held = JSON.parse(await readFile(path, 'utf8')) as { token: string };
      if (held.token === token) await unlink(path);
    } catch {
      return;
    }
  }

  async compareAndSet(expectedRevision: number, next: StoredState): Promise<{ revision: number }> {
    const result = this.transaction.then(() => this.commit(expectedRevision, next));
    this.transaction = result.catch(() => undefined);
    return result;
  }

  async claimWriter(): Promise<() => Promise<void>> {
    await this.ensureDir();
    const token = await this.acquireLock('.host-lock');
    return () => this.releaseLock(token, '.host-lock');
  }

  private async commit(expectedRevision: number, next: StoredState): Promise<{ revision: number }> {
    await this.ensureDir();
    const token = await this.acquireLock();
    try {
      const fresh = await this.readRaw();
      if (fresh.revision !== expectedRevision || next.revision !== fresh.revision + 1) {
        throw new GatewayStateError('concurrent write', 'CONFLICT');
      }
      const sealed = sealStateEnvelope(await this.dek(), next);
      await this.markInitialized();
      const destination = join(this.stateDir, STATE_FILE);
      const temporary = `${destination}.${token}.tmp`;
      const handle = await open(temporary, 'w', 0o600);
      try {
        await handle.writeFile(sealed, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, destination);
      await chmod(destination, 0o600);
      const dir = await open(this.stateDir, 'r');
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
      return { revision: next.revision };
    } catch (error) {
      if (error instanceof GatewayStateError) throw error;
      throw new GatewayStateError('durable commit failed', 'STORE-FAILED');
    } finally {
      await this.releaseLock(token);
    }
  }

  async inventory(): Promise<{ files: string[] }> {
    await this.ensureDir();
    return { files: await readdir(this.stateDir) };
  }
}
