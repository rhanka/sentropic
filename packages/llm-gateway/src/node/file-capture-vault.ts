import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { appendFile, chmod, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import {
  computeCaptureRetentionDeadline, DEFAULT_CAPTURE_ENABLED, DEFAULT_CAPTURE_RETENTION_MS,
  DEFAULT_WORKSTATION_CAPTURE_QUOTA_BYTES, type CaptureRetention, type CaptureVaultPort,
  type TurnCapturePurgeReceipt, type TurnCaptureRecord, type TurnCaptureWriteInput, type TurnCaptureWriteResult,
} from '../ports/capture-vault.js';
import type { KeyringReader } from './gateway-state-store.js';

export type CaptureVaultErrorCode = 'ACCESS-DENIED' | 'CORRUPT' | 'NOT-FOUND' | 'KEY-UNAVAILABLE' | 'STORE-FAILED';
export class CaptureVaultError extends Error {
  constructor(message: string, readonly code: CaptureVaultErrorCode) { super(message); this.name = 'CaptureVaultError'; }
}

interface CaptureEnvelope {
  readonly v: 1; readonly keyId: string; readonly stageId: string; readonly ownerScopeRef: string;
  readonly captureId: string; readonly createdAtMs: number; readonly expiresAtMs: number | null;
  readonly iv: string; readonly tag: string; readonly data: string;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const MAX_INFLATE_BYTES = 64 * 1024 * 1024;
const aadFor = (e: Pick<CaptureEnvelope, 'stageId' | 'ownerScopeRef' | 'captureId' | 'createdAtMs' | 'expiresAtMs'>): Buffer =>
  Buffer.from(JSON.stringify(['v1', e.stageId, e.ownerScopeRef, e.captureId, e.createdAtMs, e.expiresAtMs ?? null]), 'utf8');

export interface FileCaptureVaultOptions {
  readonly stateDir: string; readonly keyring: KeyringReader;
  readonly captureEnabled?: boolean; readonly retention?: CaptureRetention;
  readonly quotaBytes?: number; readonly keyId?: string;
  readonly dekKeyPrefix?: string; readonly now?: () => number;
}

export class FileCaptureVault implements CaptureVaultPort {
  readonly enabled: boolean;
  private readonly dir: string; private readonly keyring: KeyringReader;
  private readonly retention: CaptureRetention; private readonly quotaBytes: number;
  private readonly keyId: string; private readonly dekKeyPrefix: string; private readonly now: () => number;

  constructor(options: FileCaptureVaultOptions) {
    if (!options.stateDir || !isAbsolute(options.stateDir)) throw new CaptureVaultError('stateDir must be absolute', 'STORE-FAILED');
    this.enabled = options.captureEnabled ?? DEFAULT_CAPTURE_ENABLED;
    this.dir = join(options.stateDir, 'captures');
    this.keyring = options.keyring;
    this.retention = options.retention ?? { kind: 'finite', durationMs: DEFAULT_CAPTURE_RETENTION_MS };
    this.quotaBytes = options.quotaBytes ?? DEFAULT_WORKSTATION_CAPTURE_QUOTA_BYTES;
    this.keyId = options.keyId ?? 'v1';
    this.dekKeyPrefix = options.dekKeyPrefix ?? 'gateway/capture-dek';
    this.now = options.now ?? (() => Date.now());
  }

  private async ensureDir(): Promise<void> { await mkdir(this.dir, { recursive: true, mode: 0o700 }); await chmod(this.dir, 0o700); }
  private async dekFor(keyId: string): Promise<Buffer> {
    if (!SAFE_ID.test(keyId)) throw new CaptureVaultError('invalid capture keyId', 'CORRUPT');
    const raw = await this.keyring.getSecret(`${this.dekKeyPrefix}/${keyId}`);
    if (!raw || !/^[0-9a-f]{64}$/i.test(raw)) throw new CaptureVaultError('capture DEK unavailable', 'KEY-UNAVAILABLE');
    return Buffer.from(raw, 'hex');
  }
  private async auditRead(captureId: string, ownerScopeRef: string, outcome: 'ok' | 'denied' | 'corrupt'): Promise<void> {
    await this.ensureDir();
    const auditPath = join(this.dir, 'read-audit.jsonl');
    await appendFile(auditPath, `${JSON.stringify({ captureId, ownerScopeRef, readAtIso: new Date(this.now()).toISOString(), outcome })}\n`, { mode: 0o600 });
    await chmod(auditPath, 0o600);
  }
  private async totalCaptureBytes(): Promise<number> {
    let total = 0;
    for (const name of await readdir(this.dir).catch(() => [] as string[])) {
      if (name.endsWith('.enc.json')) total += (await stat(join(this.dir, name)).catch(() => ({ size: 0 }))).size;
    }
    return total;
  }

  async writeTurnCapture(input: TurnCaptureWriteInput): Promise<TurnCaptureWriteResult> {
    if (!this.enabled) return { stored: false, reason: 'capture_disabled' };
    const captureId = input.captureId ?? `cap_${randomBytes(12).toString('hex')}`;
    if (!SAFE_ID.test(captureId)) throw new CaptureVaultError('invalid captureId', 'STORE-FAILED');
    const createdAtMs = input.createdAtMs ?? this.now();
    const expiresAtMs = computeCaptureRetentionDeadline(this.retention, createdAtMs);
    const record: TurnCaptureRecord = {
      captureId, stageId: input.stageId, ownerScopeRef: input.ownerScopeRef, requestId: input.requestId,
      wire: input.wire, model: input.model, keyId: this.keyId, createdAtMs, expiresAtMs,
      requestCapture: input.requestCapture, responseCapture: input.responseCapture,
      truncated: Boolean(input.truncated), ...(input.integrity ? { integrity: input.integrity } : {}),
    };
    const iv = randomBytes(GCM_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', await this.dekFor(this.keyId), iv, { authTagLength: GCM_TAG_BYTES });
    cipher.setAAD(aadFor({ stageId: input.stageId, ownerScopeRef: input.ownerScopeRef, captureId, createdAtMs, expiresAtMs }));
    const data = Buffer.concat([cipher.update(deflateSync(Buffer.from(JSON.stringify(record), 'utf8'))), cipher.final()]);
    const serialized = JSON.stringify({
      v: 1, keyId: this.keyId, stageId: input.stageId, ownerScopeRef: input.ownerScopeRef, captureId, createdAtMs, expiresAtMs,
      iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64'),
    } satisfies CaptureEnvelope);
    const bytesNeeded = Buffer.byteLength(serialized, 'utf8');
    await this.ensureDir();
    if ((await this.totalCaptureBytes()) + bytesNeeded > this.quotaBytes) {
      await this.purgeExpiredCaptures(createdAtMs);
      if ((await this.totalCaptureBytes()) + bytesNeeded > this.quotaBytes) return { stored: false, reason: 'capture_quota_exceeded' };
    }
    const target = join(this.dir, `${captureId}.enc.json`);
    const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, serialized, { mode: 0o600 });
    await rename(tmp, target);
    await chmod(target, 0o600);
    return { stored: true, captureId, bytesStored: bytesNeeded, expiresAtMs };
  }

  async readTurnCapture(input: { readonly ownerScopeRef: string; readonly captureId: string }): Promise<TurnCaptureRecord> {
    if (!SAFE_ID.test(input.captureId)) throw new CaptureVaultError('invalid captureId', 'NOT-FOUND');
    let raw: string;
    try { raw = await readFile(join(this.dir, `${input.captureId}.enc.json`), 'utf8'); }
    catch { throw new CaptureVaultError('capture not found', 'NOT-FOUND'); }
    let env: CaptureEnvelope;
    try { env = JSON.parse(raw) as CaptureEnvelope; }
    catch { await this.auditRead(input.captureId, input.ownerScopeRef, 'corrupt'); throw new CaptureVaultError('corrupt envelope', 'CORRUPT'); }
    if (env.ownerScopeRef !== input.ownerScopeRef) {
      await this.auditRead(input.captureId, input.ownerScopeRef, 'denied');
      throw new CaptureVaultError('cross-owner capture read denied', 'ACCESS-DENIED');
    }
    if (env.v !== 1 || typeof env.keyId !== 'string' || typeof env.iv !== 'string'
      || typeof env.tag !== 'string' || typeof env.data !== 'string') {
      await this.auditRead(input.captureId, input.ownerScopeRef, 'corrupt');
      throw new CaptureVaultError('corrupt envelope', 'CORRUPT');
    }
    const iv = Buffer.from(env.iv, 'base64');
    const tag = Buffer.from(env.tag, 'base64');
    if (iv.length !== GCM_IV_BYTES || tag.length !== GCM_TAG_BYTES) {
      await this.auditRead(input.captureId, input.ownerScopeRef, 'corrupt');
      throw new CaptureVaultError('invalid capture IV or auth tag length', 'CORRUPT');
    }
    const dek = await this.dekFor(env.keyId);
    try {
      const decipher = createDecipheriv('aes-256-gcm', dek, iv, { authTagLength: GCM_TAG_BYTES });
      decipher.setAAD(aadFor({
        stageId: env.stageId, ownerScopeRef: input.ownerScopeRef, captureId: input.captureId,
        createdAtMs: env.createdAtMs, expiresAtMs: env.expiresAtMs,
      }));
      decipher.setAuthTag(tag);
      const deflated = Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]);
      const record = JSON.parse(inflateSync(deflated, { maxOutputLength: MAX_INFLATE_BYTES }).toString('utf8')) as TurnCaptureRecord;
      if (record.captureId !== input.captureId || record.ownerScopeRef !== input.ownerScopeRef) {
        throw new CaptureVaultError('capture identity mismatch', 'CORRUPT');
      }
      await this.auditRead(input.captureId, input.ownerScopeRef, 'ok');
      return record;
    } catch { await this.auditRead(input.captureId, input.ownerScopeRef, 'corrupt'); throw new CaptureVaultError('capture authentication failed', 'CORRUPT'); }
  }

  async purgeExpiredCaptures(nowMs = this.now()): Promise<TurnCapturePurgeReceipt> {
    const purgedCaptureIds: string[] = [];
    let freedBytes = 0;
    for (const name of await readdir(this.dir).catch(() => [] as string[])) {
      if (!name.endsWith('.enc.json')) continue;
      const fullPath = join(this.dir, name);
      try {
        const raw = await readFile(fullPath, 'utf8');
        const env = JSON.parse(raw) as Partial<CaptureEnvelope>;
        if (typeof env.expiresAtMs === 'number' && env.expiresAtMs <= nowMs) {
          freedBytes += Buffer.byteLength(raw, 'utf8');
          await unlink(fullPath);
          purgedCaptureIds.push(env.captureId ?? name.replace(/\.enc\.json$/, ''));
        }
      } catch { /* skip unreadable entry during purge */ }
    }
    return { purgedAtIso: new Date(nowMs).toISOString(), purgedCount: purgedCaptureIds.length, freedBytes, purgedCaptureIds };
  }
}
