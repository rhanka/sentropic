/**
 * Files parity LOT 2 §A — browser upload page (shell: signatures only).
 *
 * A web user provides images, PDF, video, fonts from their own disk. Bytes
 * go browser → S3 directly; the model never produces, reads or relays them.
 * Retrieval is pull: `artifacts_list_assets {pageSessionId}`, then the model
 * publishes with `{path, uploadId}` assets (LOT 1 bundle, unchanged).
 */
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

export interface UploadPageService {
  mint(): Promise<never>;
  exchange(): Promise<never>;
  createFile(): Promise<never>;
  commitFile(): Promise<never>;
  listStaged(): Promise<never>;
}

export function createUploadPageService(): UploadPageService {
  throw new Error('not implemented');
}
