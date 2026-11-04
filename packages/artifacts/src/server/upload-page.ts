/**
 * Files parity LOT 2 §A — browser upload page (signatures; body in Lot 2).
 *
 * A web user provides images, PDF, video, fonts from their own disk. Bytes
 * go browser → S3 directly; the model never produces, reads or relays them.
 * Retrieval is pull: `artifacts_list_assets {pageSessionId}`, then the model
 * publishes with `{path, uploadId}` assets (LOT 1 bundle, unchanged).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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

export function createUploadPageService(_deps: UploadPageServiceDeps,
  _options?: { now?: () => Date; ids?: () => string; pageTtlMs?: number;
    maxOpenPages?: number }): UploadPageService {
  throw new Error('not implemented');
}
