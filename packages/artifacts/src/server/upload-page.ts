/**
 * Files parity LOT 2 §A — browser upload page (signatures; body in Lot 2).
 *
 * A web user provides images, PDF, video, fonts from their own disk. Bytes
 * go browser → S3 directly; the model never produces, reads or relays them.
 * Retrieval is pull: `artifacts_list_assets {pageSessionId}`, then the model
 * publishes with `{path, uploadId}` assets (LOT 1 bundle, unchanged).
 */
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
  throw new Error('not implemented');
}

export interface UploadPageCookieSigner {
  sign(pageSessionId: string): string;
  verify(value: string): string;
}

export function createHmacUploadPageCookieSigner(): UploadPageCookieSigner {
  throw new Error('not implemented');
}

export function buildUploadPageCookie(): string {
  throw new Error('not implemented');
}

export function parseUploadPageCookie(): string | undefined {
  throw new Error('not implemented');
}

export function uploadPageCsp(): string {
  throw new Error('not implemented');
}

export function renderUploadPage(): string {
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

export function createUploadPageService(): UploadPageService {
  throw new Error('not implemented');
}
