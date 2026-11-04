/**
 * Files parity LOT 2 §A — browser upload page (signatures; body in Lot 2).
 *
 * A web user provides images, PDF, video, fonts from their own disk. Bytes
 * go browser → S3 directly; the model never produces, reads or relays them.
 * Retrieval is pull: `artifacts_list_assets {pageSessionId}`, then the model
 * publishes with `{path, uploadId}` assets (LOT 1 bundle, unchanged).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SERVER_MAX_UPLOAD_SESSIONS_PER_PRINCIPAL } from './publication-limits.js';
import { commitStagedUpload, createUploadService } from './uploads.js';
import type { StagedFileRecord, StagingStore, UploadSessionStore, UploadSignerPort } from './uploads.js';
import type { PublicationBlobStore } from './publication.js';
import type { RefcountStore } from './gc.js';
import type { IdempotencyStore } from './idempotency.js';
import type { ArtifactsMetrics } from './metrics.js';

export const UPLOAD_PAGE_TTL_MS = 20 * 60 * 1000;
export const UPLOAD_PAGE_COOKIE = '__Host-artifacts_upload';
export const SERVER_MAX_OPEN_UPLOAD_PAGES = 4;

export type UploadPageState = 'open' | 'exchanged' | 'closed' | 'expired';

export interface UploadPageRow {
  readonly pageSessionId: string;
  readonly artifactId: string;
  readonly storageScopeId: string;
  readonly ownerId: string;
  readonly tokenHash: string;
  readonly state: UploadPageState;
  readonly maxFiles: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly exchangedAt?: string;
}

export interface UploadPageStore {
  create(row: UploadPageRow): Promise<void>;
  get(pageSessionId: string): Promise<UploadPageRow | undefined>;
  countActiveByOwner(ownerId: string): Promise<number>;
  listExpiredPages(now: Date): Promise<UploadPageRow[]>;
  markExchanged(pageSessionId: string, at: string): Promise<void>;
  markExpired(pageSessionId: string): Promise<void>;
}

export function createMemoryUploadPageStore(): UploadPageStore {
  const rows = new Map<string, UploadPageRow>();
  const live = (row: UploadPageRow): boolean => row.state === 'open' || row.state === 'exchanged';
  return {
    create(row) {
      if (rows.has(row.pageSessionId)) throw new Error(`duplicate upload page: ${row.pageSessionId}`);
      rows.set(row.pageSessionId, row);
      return Promise.resolve();
    },
    get(pageSessionId) {
      return Promise.resolve(rows.get(pageSessionId));
    },
    countActiveByOwner(ownerId) {
      let count = 0;
      for (const row of rows.values()) {
        if (row.ownerId === ownerId && live(row)) count += 1;
      }
      return Promise.resolve(count);
    },
    listExpiredPages(at) {
      return Promise.resolve([...rows.values()].filter((row) =>
        live(row) && new Date(row.expiresAt).getTime() <= at.getTime()));
    },
    markExchanged(pageSessionId, at) {
      const row = rows.get(pageSessionId);
      if (row === undefined) throw new Error(`unknown upload page: ${pageSessionId}`);
      if (row.state !== 'open') throw new Error(`upload page not open (${row.state}): ${pageSessionId}`);
      rows.set(pageSessionId, { ...row, state: 'exchanged', exchangedAt: at });
      return Promise.resolve();
    },
    markExpired(pageSessionId) {
      const row = rows.get(pageSessionId);
      if (row === undefined) throw new Error(`unknown upload page: ${pageSessionId}`);
      rows.set(pageSessionId, { ...row, state: 'expired' });
      return Promise.resolve();
    },
  };
}

export interface UploadPageCookieSigner {
  sign(pageSessionId: string): string;
  verify(value: string): string;
}

/**
 * HMAC cookie signer for one upload page (mirrors `content/grants.ts`).
 * The cookie carries `{sid, exp}`; the page row carries state and expiry, so
 * a stolen cookie is bounded by the row TTL and the owner binding.
 */
export function createHmacUploadPageCookieSigner(options: { secret: string | Uint8Array;
  clock?: () => number; ttlSeconds?: number }): UploadPageCookieSigner {
  const secret = typeof options.secret === 'string'
    ? new TextEncoder().encode(options.secret)
    : options.secret;
  if (secret.length === 0) throw new Error('invalid page cookie signer: empty secret');
  const clock = options.clock ?? (() => Date.now());
  const ttlMs = (options.ttlSeconds ?? UPLOAD_PAGE_TTL_MS / 1000) * 1000;
  const encode = (claims: { sid: string; exp: number }): string =>
    Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return {
    sign(pageSessionId: string): string {
      if (pageSessionId.length === 0) throw new Error('invalid page cookie: empty session');
      const payload = encode({ sid: pageSessionId, exp: clock() + ttlMs });
      const sig = createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
      return `${payload}.${sig}`;
    },
    verify(value: string): string {
      const parts = value.split('.');
      if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
        throw new Error('invalid page cookie: malformed token');
      }
      const expected = Buffer.from(createHmac('sha256', secret).update(parts[0], 'utf8').digest('base64url'), 'utf8');
      const actual = Buffer.from(parts[1], 'utf8');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        throw new Error('invalid page cookie: signature mismatch');
      }
      let claims: { sid?: unknown; exp?: unknown };
      try {
        claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as typeof claims;
      } catch {
        throw new Error('invalid page cookie: malformed claims');
      }
      if (typeof claims.sid !== 'string' || claims.sid.length === 0 ||
        !Number.isFinite(claims.exp) || (claims.exp as number) <= clock()) {
        throw new Error('invalid page cookie: expired or malformed claims');
      }
      return claims.sid;
    },
  };
}

/**
 * Host-only page cookie value (review finding 1: the `__Host-` prefix
 * requires `Path=/`, exactly like the shipped grant cookie).
 */
export function buildUploadPageCookie(value: string, maxAgeSeconds: number): string {
  if (value.length === 0 || !Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1) {
    throw new Error('invalid page cookie value');
  }
  return `${UPLOAD_PAGE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function parseUploadPageCookie(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${UPLOAD_PAGE_COOKIE}=`)) {
      const value = trimmed.slice(UPLOAD_PAGE_COOKIE.length + 1);
      return value.length === 0 ? undefined : value;
    }
  }
  return undefined;
}

/** Page CSP (§A.4): no external assets; S3 origins are host-supplied. */
export function uploadPageCsp(s3Origins: readonly string[]): string {
  if (s3Origins.length === 0 || s3Origins.some((origin) =>
    !/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(origin))) {
    throw new Error('invalid page S3 origins: the page refuses to render without them');
  }
  return ['default-src \'none\'', 'script-src \'self\'', 'style-src \'self\'',
    'img-src \'self\' blob:', 'font-src \'self\'', `connect-src 'self' ${s3Origins.join(' ')}`,
    'base-uri \'none\'', 'form-action \'none\'', 'frame-ancestors \'none\''].join('; ');
}

export function renderUploadPage(_options: { s3Origins: readonly string[] }): string {
  throw new Error('not implemented');
}

export interface UploadPageProfileCaps {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly mimeTypes: readonly string[];
  /** Manifest path byte budget (profile `pathMaxBytes`); absent ⇒ 1024. */
  readonly pathMaxBytes?: number;
}

export interface UploadPageServiceDeps {
  readonly pages: UploadPageStore;
  readonly sessions: UploadSessionStore;
  readonly staging: StagingStore;
  readonly signer: UploadSignerPort;
  readonly blobs: PublicationBlobStore;
  readonly refs: RefcountStore;
  readonly idempotency?: IdempotencyStore;
  readonly cookieSigner: UploadPageCookieSigner;
  readonly controlOrigin: string;
  readonly pageBaseUrl: string;
  readonly s3Origins: readonly string[];
  readonly profile: UploadPageProfileCaps;
  /** Per-artifact staged caps, enforced at commit for the browser channel. */
  readonly budget: { filesMax: number; totalBytesMax: number };
  /** Per-scope staging aggregate shared with the agent channel. */
  readonly stagingQuotaBytesPerScope?: number;
  readonly metrics?: ArtifactsMetrics;
}

export interface MintUploadPageInput {
  readonly artifactId: string;
  readonly storageScopeId: string;
  readonly ownerId: string;
  readonly maxFiles?: number;
}

export interface UploadPageMint {
  readonly pageSessionId: string;
  readonly token: string;
  readonly uploadPageUrl: string;
  readonly expiresAt: string;
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly allowedMimeTypes: readonly string[];
}

export interface UploadPageExchange {
  readonly cookie: string;
  readonly maxAgeSeconds: number;
}

export interface PageFileInput {
  readonly cookie: string;
  readonly origin: string;
  readonly customHeader: boolean;
  readonly artifactId: string;
  readonly path: string;
  readonly mimeType: string;
  readonly size: number;
}

export interface PageCommitInput extends PageFileInput {
  readonly uploadId: string;
  readonly digest: string;
  readonly idempotencyKey: string;
}

export interface UploadPageService {
  mint(input: MintUploadPageInput): Promise<UploadPageMint>;
  exchange(input: { pageSessionId: string; token: string; origin: string }): Promise<UploadPageExchange>;
  createFile(input: PageFileInput): Promise<{ uploadId: string; uploadUrl: string; method: 'PUT';
    expiresAt: string; maxSize: number; requiredHeaders: Record<string, string>;
    checksumHeader: 'x-amz-checksum-sha256'; stagingKey: string }>;
  commitFile(input: PageCommitInput): Promise<StagedFileRecord>;
  listStaged(input: { cookie: string; origin: string; customHeader: boolean;
    artifactId: string }): Promise<StagedFileRecord[]>;
}

export function createUploadPageService(deps: UploadPageServiceDeps,
  options?: { now?: () => Date; ids?: () => string; randomToken?: () => string; pageTtlMs?: number;
    maxOpenPages?: number }): UploadPageService {
  const now = options?.now ?? (() => new Date());
  const ids = options?.ids ?? (() => crypto.randomUUID());
  const randomToken = options?.randomToken ?? (() => randomBytes(32).toString('base64url'));
  const pageTtlMs = options?.pageTtlMs ?? UPLOAD_PAGE_TTL_MS;
  const maxOpenPages = options?.maxOpenPages ?? SERVER_MAX_OPEN_UPLOAD_PAGES;
  if (!Number.isSafeInteger(pageTtlMs) || pageTtlMs < 1) throw new Error('invalid page TTL');
  if (!Number.isSafeInteger(maxOpenPages) || maxOpenPages < 1) throw new Error('invalid page quota');
  if (deps.controlOrigin.length === 0 || deps.pageBaseUrl.length === 0) {
    throw new Error('invalid page host configuration');
  }
  if (!Number.isSafeInteger(deps.budget.filesMax) || deps.budget.filesMax < 1 ||
    !Number.isSafeInteger(deps.budget.totalBytesMax) || deps.budget.totalBytesMax < 1) {
    throw new Error('invalid page staged budget');
  }
  const pathMaxBytes = deps.profile.pathMaxBytes ?? 1024;
  const emit = (event: { name: string; labels?: Record<string, string>; value?: number }): void => {
    if (deps.metrics !== undefined) deps.metrics.emit(event);
  };
  // The browser channel shares the session ledger with the agent channel, so
  // the 8-open-session quota and the scope aggregate cover both together.
  const uploads = createUploadService(
    { sessions: deps.sessions, staging: deps.staging, signer: deps.signer },
    { maxUploadBytes: deps.profile.maxFileBytes,
      maxSessionsPerPrincipal: SERVER_MAX_UPLOAD_SESSIONS_PER_PRINCIPAL,
      ...(deps.stagingQuotaBytesPerScope === undefined ? {} : {
        stagingQuotaBytesPerScope: deps.stagingQuotaBytesPerScope }),
      channel: 'browser', metrics: deps.metrics, now, ids });
  // Per-owner mint serialization (the store check and insert stay paired).
  const mintTails = new Map<string, Promise<unknown>>();
  const serializedMint = <T>(ownerId: string, action: () => Promise<T>): Promise<T> => {
    const previous = mintTails.get(ownerId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mintTails.set(ownerId, previous.then(() => gate));
    return previous.then(action).finally(release);
  };
  const tokenHashOf = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');
  const timedEqualHex = (left: string, right: string): boolean => {
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const liveRow = async (pageSessionId: string): Promise<UploadPageRow> => {
    const row = await deps.pages.get(pageSessionId);
    if (row === undefined || (row.state !== 'open' && row.state !== 'exchanged')) {
      throw new Error(`unknown upload page: ${pageSessionId}`);
    }
    if (new Date(row.expiresAt).getTime() <= now().getTime()) {
      await deps.pages.markExpired(pageSessionId).catch(() => undefined);
      throw new Error(`upload page expired: ${pageSessionId}`);
    }
    return row;
  };
  const checkPageRequest = async (input: { cookie: string; origin: string; customHeader: boolean;
    artifactId: string }): Promise<UploadPageRow> => {
    // Same simple-request CSRF defence as `apps/artifact-content` `/_reader/activate`.
    if (input.origin !== deps.controlOrigin || input.customHeader !== true) {
      throw new Error('forbidden page request: origin or header mismatch');
    }
    const value = parseUploadPageCookie(input.cookie);
    if (value === undefined) throw new Error('forbidden page request: missing page cookie');
    const row = await liveRow(deps.cookieSigner.verify(value));
    if (row.artifactId !== input.artifactId) {
      throw new Error('forbidden page request: page bound to another artifact');
    }
    return row;
  };
  const checkPath = (path: unknown): void => {
    if (typeof path !== 'string' || path.length === 0 || Buffer.byteLength(path, 'utf8') > pathMaxBytes) {
      throw new Error('invalid page asset path');
    }
  };
  return {
    async mint(input) {
      if (input.artifactId.length === 0 || input.storageScopeId.length === 0 || input.ownerId.length === 0) {
        throw new Error('invalid page mint: empty binding');
      }
      return serializedMint(input.ownerId, async () => {
        const active = await deps.pages.countActiveByOwner(input.ownerId);
        if (active >= maxOpenPages) {
          emit({ name: 'upload_quota_refusals', labels: { reason: 'open_page_quota' } });
          throw new Error(`open upload page quota exceeded for principal (max ${maxOpenPages})`);
        }
        const maxFiles = Math.min(input.maxFiles ?? deps.profile.maxFiles, deps.profile.maxFiles);
        if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) throw new Error('invalid page file bound');
        const pageSessionId = ids();
        const token = randomToken();
        const at = now();
        const row: UploadPageRow = { pageSessionId, artifactId: input.artifactId,
          storageScopeId: input.storageScopeId, ownerId: input.ownerId, tokenHash: tokenHashOf(token),
          state: 'open', maxFiles, createdAt: at.toISOString(),
          expiresAt: new Date(at.getTime() + pageTtlMs).toISOString() };
        await deps.pages.create(row);
        emit({ name: 'upload_pages_minted' });
        return { pageSessionId, token,
          uploadPageUrl: `${deps.pageBaseUrl.replace(/\/$/, '')}/artifacts/upload/${pageSessionId}#t=${token}`,
          expiresAt: row.expiresAt, maxFiles, maxFileBytes: deps.profile.maxFileBytes,
          maxTotalBytes: deps.profile.maxTotalBytes, allowedMimeTypes: [...deps.profile.mimeTypes] };
      });
    },
    async exchange(input) {
      if (input.origin !== deps.controlOrigin) throw new Error('forbidden page exchange: origin mismatch');
      const row = await liveRow(input.pageSessionId);
      if (row.state !== 'open') throw new Error(`upload page not open (${row.state}): ${input.pageSessionId}`);
      if (!timedEqualHex(tokenHashOf(input.token), row.tokenHash)) {
        throw new Error('forbidden page exchange: token mismatch');
      }
      await deps.pages.markExchanged(input.pageSessionId, now().toISOString());
      emit({ name: 'upload_pages_exchanged' });
      const remainingMs = new Date(row.expiresAt).getTime() - now().getTime();
      const maxAgeSeconds = Math.max(1, Math.floor(remainingMs / 1000));
      return { cookie: buildUploadPageCookie(deps.cookieSigner.sign(input.pageSessionId), maxAgeSeconds),
        maxAgeSeconds };
    },
    async createFile(_input) {
      throw new Error('not implemented');
    },
    async commitFile(_input) {
      throw new Error('not implemented');
    },
    async listStaged(_input) {
      throw new Error('not implemented');
    },
  };
}
