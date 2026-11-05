/**
 * Files parity LOT 1 — durable upload sessions with a presigned signed PUT
 * (design-r1 §B.3, review finding 3 applied).
 *
 * Bytes never travel through the model or the MCP host: `create_upload`
 * mints a presigned PUT for exactly one staging key
 * `artifacts/<scope>/staging/<uploadId>`; the local agent performs the PUT;
 * `commit_upload` re-reads the staged object once and verifies the declared
 * size and SHA-256 digest before anything is pinned.
 *
 * SigV4 note (review finding 3, hardened 0.2.16): a presigned PUT cannot
 * carry a content-length RANGE (that exists only in POST policies), so the
 * signature binds an EXACT Content-Length (the declared size) plus
 * content-type — and nothing else. The digest is declared at commit, so no
 * checksum header can be signed at create time; announcing one anyway makes
 * strict S3 implementations (OVH) refuse the PUT with 403 because the header
 * is present but not signed. The client therefore sends exactly the announced
 * headers, and commit re-reads the staged object once and re-verifies size,
 * SHA-256 digest and MIME server-side before pinning (fail-closed: any
 * mismatch refuses with a typed error, deletes the staged object, closes the
 * session, and creates no release). Residual exposure of a leaked URL is
 * bounded by the declared size (≤ 16 MiB), the per-principal open-session
 * quota and the enforced sweeper (gc.ts).
 *
 * Sessions are durable rows (migration 0007 ALTERs `artifacts.uploads`);
 * the byte store, session store and signer are injected ports — the memory
 * doubles serve unit tests, the S3 adapter serves the host.
 */
import { createHash } from 'node:crypto';
import { validateFileBytes } from './mime.js';
import type { ArtifactsMetrics } from './metrics.js';
import type { RefcountStore } from './gc.js';
import type { PublicationBlobStore } from './publication.js';

export const UPLOAD_URL_TTL_SECONDS = 600; // presigned URL: ≤ 10 minutes
export const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // staged file: 24 h
/**
 * Files parity LOT 2 §D — staged-file TTL (host option, ceiling 7 days),
 * orphan staging-key grace, and the per-run orphan bound.
 */
export const STAGED_FILE_TTL_MS = 24 * 60 * 60 * 1000;
export const STAGED_FILE_TTL_MAX_MS = 7 * 24 * 60 * 60 * 1000;
export const ORPHAN_STAGING_GRACE_MS = 60 * 60 * 1000;
export const ORPHAN_SWEEP_MAX_KEYS = 500;

export type UploadSessionState = 'open' | 'committed' | 'discarded' | 'expired';

export interface UploadSession {
  readonly uploadId: string;
  readonly artifactId: string;
  readonly storageScopeId: string;
  readonly ownerId: string;
  readonly mimeType: string;
  readonly maxSize: number;
  readonly state: UploadSessionState;
  readonly expiresAt: string;
  readonly createdAt: string;
  /** Browser page that minted this session (agent-channel rows stay null). */
  readonly pageSessionId?: string;
}

export interface StagedFileRecord {
  readonly uploadId: string;
  readonly artifactId: string;
  readonly path: string;
  readonly mimeType: string;
  readonly digest: string;
  readonly size: number;
  readonly createdAt: string;
  /** Browser page the file was committed through (agent-channel rows stay null). */
  readonly pageSessionId?: string;
}

/** Durable session ledger (Postgres in the host via migration 0007; memory double in tests). */
export interface UploadSessionStore {
  create(session: UploadSession): Promise<void>;
  get(uploadId: string): Promise<UploadSession | undefined>;
  /** Open sessions of one principal in one scope (quota check). */
  countOpen(storageScopeId: string, ownerId: string): Promise<number>;
  /** Sessions still open whose expires_at passed (sweeper input). */
  listExpiredOpen(now: Date): Promise<UploadSession[]>;
  markCommitted(uploadId: string): Promise<void>;
  markExpired(uploadId: string): Promise<void>;
  recordStagedFile(record: StagedFileRecord): Promise<void>;
  getStagedFile(uploadId: string): Promise<StagedFileRecord | undefined>;
  listStagedFiles(artifactId: string): Promise<StagedFileRecord[]>;
  /** LOT 2 §D.2: reserved bytes of open sessions in one scope (quota check). */
  sumOpenMaxSize(storageScopeId: string): Promise<number>;
  /** LOT 2 §D.2: staged bytes in one scope (quota check). */
  sumStagedBytesByScope(storageScopeId: string): Promise<number>;
  /** LOT 2 §A.3: sessions minted through one browser page (file-count bound). */
  listPageSessions(pageSessionId: string): Promise<UploadSession[]>;
  /**
   * LOT 2 §D.2: serialize the quota check and insert per scope (race-proof
   * backstop). The PG store runs `action` on a transaction holding the scope
   * advisory lock; the memory double runs it under a per-scope mutex. The
   * service performs every quota read and the insert through `locked`.
   */
  withScopeLock<T>(storageScopeId: string, action: (locked: UploadSessionStore) => Promise<T>): Promise<T>;
  /** LOT 2 §D.1: staged rows older than the TTL (sweeper pass 2 input). */
  listExpiredStaged(now: Date, ttlMs: number): Promise<StagedFileRecord[]>;
  deleteStagedFile(uploadId: string): Promise<void>;
}

/** Byte store under the staging prefix (S3 in the host; memory double in tests). */
export interface StagingStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
  /** LOT 2 §D.1 orphan pass: keys with last write time (optional; absent ⇒ pass skipped). */
  listEntries?(prefix: string): Promise<{ key: string; lastModified: string }[]>;
}

/**
 * Presigner port. The signature binds content-type and the EXACT
 * content-length (declared size); no content-length range exists in a SigV4
 * presigned PUT (review finding 3). No checksum header is signed: the digest
 * is declared at commit, and announcing an unsigned `x-amz-*` header makes
 * strict S3 implementations refuse the PUT. The returned headers are the
 * whole contract: the client sends exactly these headers, nothing more.
 */
export interface UploadSignerPort {
  signPut(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<{
    url: string;
    method: 'PUT';
    /** Headers the client must send with exactly these values. */
    headers: Record<string, string>;
    expiresAt: string;
  }>;
}

/**
 * Typed verification failure for the upload channel (fail-closed commit).
 * Hosts map this to `verification_failed` without trusting the message text.
 */
export type UploadVerificationReason =
  | 'unknown_upload'
  | 'session_not_open'
  | 'session_expired'
  | 'staged_missing'
  | 'size_mismatch'
  | 'digest_mismatch'
  | 'mime_mismatch'
  | 'cas_readback_mismatch';

export class UploadVerificationError extends Error {
  readonly reason: UploadVerificationReason;
  readonly uploadId: string;
  constructor(reason: UploadVerificationReason, uploadId: string, message: string) {
    super(message);
    this.name = 'UploadVerificationError';
    this.reason = reason;
    this.uploadId = uploadId;
  }
}

export const STAGING_KEY_PATTERN = /^artifacts\/[A-Za-z0-9_-]+\/staging\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Staging key of one upload session. */
export function stagingKey(storageScopeId: string, uploadId: string): string {
  return `artifacts/${storageScopeId}/staging/${uploadId}`;
}

/** Staging prefix of one scope (LOT 2 §D.1 orphan pass enumerates it). */
export function stagingPrefix(storageScopeId: string): string {
  return `artifacts/${storageScopeId}/staging/`;
}

/** Reject anything but a staging key, before any I/O. */
export function assertStagingKey(key: string): void {
  if (!STAGING_KEY_PATTERN.test(key)) {
    throw new Error(`invalid staging key (must be artifacts/<scope>/staging/<uuid>): ${key}`);
  }
}

/** Reject empty or escaping staging prefixes before enumeration. */
export function assertStagingPrefix(prefix: string): void {
  if (prefix.length === 0 || prefix.includes('..') || !prefix.endsWith('/staging/')) {
    throw new Error(`invalid staging prefix: ${prefix}`);
  }
}

/** In-memory StagingStore double for unit tests. */
export function createMemoryStaging(now: () => Date = () => new Date()): StagingStore {
  const staged = new Map<string, { bytes: Uint8Array; lastModified: string }>();
  return {
    put(key: string, bytes: Uint8Array): Promise<void> {
      assertStagingKey(key);
      staged.set(key, { bytes: new Uint8Array(bytes), lastModified: now().toISOString() });
      return Promise.resolve();
    },
    get(key: string): Promise<Uint8Array | undefined> {
      assertStagingKey(key);
      const entry = staged.get(key);
      return Promise.resolve(entry === undefined ? undefined : new Uint8Array(entry.bytes));
    },
    delete(key: string): Promise<void> {
      assertStagingKey(key);
      staged.delete(key);
      return Promise.resolve();
    },
    listKeys(prefix: string): Promise<string[]> {
      assertStagingPrefix(prefix);
      return Promise.resolve([...staged.keys()].filter((key) => key.startsWith(prefix)).sort());
    },
    listEntries(prefix: string): Promise<{ key: string; lastModified: string }[]> {
      assertStagingPrefix(prefix);
      return Promise.resolve([...staged.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, entry]) => ({ key, lastModified: entry.lastModified })).sort((a, b) => (a.key < b.key ? -1 : 1)));
    },
  };
}

/** In-memory UploadSessionStore double for unit tests. */
export function createMemoryUploadSessionStore(now: () => Date = () => new Date()): UploadSessionStore {
  const sessions = new Map<string, UploadSession>();
  const stagedFiles = new Map<string, StagedFileRecord>();
  // LOT 2 §D.2: per-scope serialization of the quota check and insert.
  const scopeTails = new Map<string, Promise<unknown>>();
  const scopeLock = <T>(storageScopeId: string, action: (locked: UploadSessionStore) => Promise<T>): Promise<T> => {
    const previous = scopeTails.get(storageScopeId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    scopeTails.set(storageScopeId, previous.then(() => gate));
    return previous.then(() => action(store)).finally(release);
  };
  const scopeOfStaged = (record: StagedFileRecord): string | undefined =>
    sessions.get(record.uploadId)?.storageScopeId;
  const store: UploadSessionStore = {
    create(session) {
      sessions.set(session.uploadId, session);
      return Promise.resolve();
    },
    get(uploadId) {
      return Promise.resolve(sessions.get(uploadId));
    },
    countOpen(storageScopeId, ownerId) {
      let count = 0;
      for (const session of sessions.values()) {
        if (session.storageScopeId === storageScopeId && session.ownerId === ownerId && session.state === 'open') count += 1;
      }
      return Promise.resolve(count);
    },
    listExpiredOpen(at) {
      return Promise.resolve([...sessions.values()].filter((session) =>
        session.state === 'open' && new Date(session.expiresAt).getTime() <= at.getTime()).sort());
    },
    markCommitted(uploadId) {
      const session = sessions.get(uploadId);
      if (session === undefined) throw new Error(`unknown upload: ${uploadId}`);
      sessions.set(uploadId, { ...session, state: 'committed' });
      return Promise.resolve();
    },
    markExpired(uploadId) {
      const session = sessions.get(uploadId);
      if (session === undefined) throw new Error(`unknown upload: ${uploadId}`);
      sessions.set(uploadId, { ...session, state: 'expired' });
      return Promise.resolve();
    },
    recordStagedFile(record) {
      stagedFiles.set(record.uploadId, record);
      return Promise.resolve();
    },
    getStagedFile(uploadId) {
      return Promise.resolve(stagedFiles.get(uploadId));
    },
    listStagedFiles(artifactId) {
      return Promise.resolve([...stagedFiles.values()].filter((record) => record.artifactId === artifactId));
    },
    sumOpenMaxSize(storageScopeId) {
      let total = 0;
      for (const session of sessions.values()) {
        if (session.storageScopeId === storageScopeId && session.state === 'open') total += session.maxSize;
      }
      return Promise.resolve(total);
    },
    sumStagedBytesByScope(storageScopeId) {
      let total = 0;
      for (const record of stagedFiles.values()) {
        if (scopeOfStaged(record) === storageScopeId) total += record.size;
      }
      return Promise.resolve(total);
    },
    listPageSessions(pageSessionId) {
      return Promise.resolve([...sessions.values()].filter((session) => session.pageSessionId === pageSessionId));
    },
    withScopeLock: scopeLock,
    listExpiredStaged(at, ttlMs) {
      return Promise.resolve([...stagedFiles.values()].filter((record) =>
        new Date(record.createdAt).getTime() + ttlMs <= at.getTime()));
    },
    deleteStagedFile(uploadId) {
      stagedFiles.delete(uploadId);
      return Promise.resolve();
    },
  };
  return store;
}

/**
 * Memory signer double: records every signed PUT and simulates S3's
 * enforcement of the signed headers (exact content-length equality) and of
 * the checksum header (body must hash to it when present).
 */
export function createMemoryUploadSigner() {
  const signed: {
    key: string; contentType: string; contentLength: number;
    expiresAt: string; url: string;
  }[] = [];
  const signer: UploadSignerPort = {
    signPut(input) {
      assertStagingKey(input.key);
      if (!Number.isSafeInteger(input.contentLength) || input.contentLength < 0) {
        throw new Error('invalid signed content-length');
      }
      const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000).toISOString();
      const url = `https://s3.test/${input.key}?X-Amz-Signature=mem-${signed.length}`;
      signed.push({ key: input.key, contentType: input.contentType, contentLength: input.contentLength,
        expiresAt, url });
      return Promise.resolve({
        url,
        method: 'PUT' as const,
        headers: {
          'content-type': input.contentType,
          'content-length': String(input.contentLength),
        },
        expiresAt,
      });
    },
  };
  return {
    signer,
    signed,
    /**
     * Simulate the client PUT against a strict "S3": the signed headers are
     * enforced exactly, and any `x-amz-*` header outside the signed set is
     * refused — mirroring OVH S3, which rejects a presigned PUT carrying an
     * unsigned `x-amz-checksum-sha256` with 403 AccessDenied.
     */
    put(signedPut: { key: string; contentType: string; contentLength: number },
      bytes: Uint8Array, headers: Record<string, string>): void {
      if (String(bytes.length) !== headers['content-length'] || bytes.length !== signedPut.contentLength) {
        throw new Error(`content-length mismatch: signed ${signedPut.contentLength}, body ${bytes.length}`);
      }
      if (headers['content-type'] !== signedPut.contentType) {
        throw new Error('content-type mismatch with the signed header');
      }
      for (const key of Object.keys(headers)) {
        if (key.startsWith('x-amz-')) {
          throw new Error(`x-amz header present but not signed: ${key}`);
        }
      }
    },
  };
}

export interface CreateUploadInput {
  artifactId: string;
  storageScopeId: string;
  ownerId: string;
  mimeType: string;
  /** Declared size; clamped to the host budget. Bound as the exact signed Content-Length. */
  maxSize?: number;
  /** Browser page that mints this session (agent-channel rows stay null). */
  pageSessionId?: string;
  /** Page file bound enforced with the quota check; required when pageSessionId is set. */
  pageFileLimit?: number;
}

/** Digest-addressed CAS blob key of one scope and canonical `sha256:<hex>` digest. */
export function casBlobKey(storageScopeId: string, digest: string): string {
  return `artifacts/${storageScopeId}/blobs/${digest.replace(':', '/')}`;
}

/** LOT 2 §D.1: true when a staged file is older than the staged-file TTL. */
export function stagedFileExpired(record: Pick<StagedFileRecord, 'createdAt'>, nowMs: number, ttlMs: number): boolean {
  return new Date(record.createdAt).getTime() + ttlMs <= nowMs;
}

export interface CreateUploadResult {
  uploadId: string;
  uploadUrl: string;
  method: 'PUT';
  /** Presigned-URL expiry (≤ 10 minutes). */
  expiresAt: string;
  maxSize: number;
  /**
   * Exactly the signed header set (`content-type` + `content-length`): the
   * client sends these headers with exactly these values and nothing else.
   * No `x-amz-*` header is announced, because no `x-amz-*` header is signed
   * and strict S3 implementations refuse unsigned ones.
   */
  requiredHeaders: Record<string, string>;
  stagingKey: string;
}

export interface CommitUploadInput {
  uploadId: string;
  artifactId: string;
  storageScopeId: string;
  ownerId: string;
  path: string;
  mimeType: string;
  digest: string;
  size: number;
}

export interface UploadServiceOptions {
  /** Host ceiling for one upload (min of profile releaseFileBytesMax and the server maximum). */
  maxUploadBytes: number;
  maxSessionsPerPrincipal: number;
  /** LOT 2 §D.2: per-scope staging aggregate (reserved open + staged bytes). Absent ⇒ no aggregate bound. */
  stagingQuotaBytesPerScope?: number;
  /** LOT 2 §D.1: staged-file TTL (host option, ceiling 7 days). Absent ⇒ 24 h. */
  stagedFileTtlMs?: number;
  /** Metric channel of sessions minted through this service (`agent` or `browser`). */
  channel?: string;
  metrics?: ArtifactsMetrics;
  now?: () => Date;
  ids?: () => string;
}

export interface UploadService {
  create(input: CreateUploadInput): Promise<CreateUploadResult>;
  /**
   * Load the session for commit: must exist, be open, unexpired and bound to
   * the same artifact + scope + owner. Returns the session (caller reads the
   * staged bytes once and verifies size/digest/MIME before pinning).
   */
  sessionForCommit(input: CommitUploadInput): Promise<UploadSession>;
  /** Verify the staged bytes against the declared size, digest and MIME type. */
  verifyStaged(session: UploadSession, bytes: Uint8Array, expected: { digest: string; size: number; mimeType: string }): void;
  /** Record the staged file and close the session after a successful promotion. */
  completeCommit(session: UploadSession, record: Omit<StagedFileRecord, 'uploadId' | 'artifactId' | 'createdAt'>): Promise<StagedFileRecord>;
}

export function createUploadService(deps: {
  sessions: UploadSessionStore;
  staging: StagingStore;
  signer: UploadSignerPort;
}, options: UploadServiceOptions): UploadService {
  const now = options.now ?? (() => new Date());
  const ids = options.ids ?? (() => crypto.randomUUID());
  if (!Number.isSafeInteger(options.maxUploadBytes) || options.maxUploadBytes < 1) {
    throw new Error('invalid upload byte budget');
  }
  if (!Number.isSafeInteger(options.maxSessionsPerPrincipal) || options.maxSessionsPerPrincipal < 1) {
    throw new Error('invalid upload session quota');
  }
  if (options.stagingQuotaBytesPerScope !== undefined &&
    (!Number.isSafeInteger(options.stagingQuotaBytesPerScope) || options.stagingQuotaBytesPerScope < 1)) {
    throw new Error('invalid scope staging quota');
  }
  if (options.stagedFileTtlMs !== undefined &&
    (!Number.isSafeInteger(options.stagedFileTtlMs) || options.stagedFileTtlMs < 1 ||
      options.stagedFileTtlMs > STAGED_FILE_TTL_MAX_MS)) {
    throw new Error('invalid staged file TTL');
  }
  const channel = options.channel ?? 'agent';
  const emit = (event: { name: string; labels?: Record<string, string>; value?: number }): void => {
    if (options.metrics !== undefined) options.metrics.emit({ ...event,
      labels: { channel, ...(event.labels ?? {}) } });
  };
  return {
    async create(input) {
      if (input.maxSize !== undefined && (!Number.isSafeInteger(input.maxSize) || input.maxSize < 1)) {
        throw new Error('invalid upload byte budget');
      }
      if (input.pageSessionId !== undefined && (input.pageFileLimit === undefined ||
        !Number.isSafeInteger(input.pageFileLimit) || input.pageFileLimit < 1)) {
        throw new Error('invalid page file bound');
      }
      const maxSize = Math.min(input.maxSize ?? options.maxUploadBytes, options.maxUploadBytes);
      // LOT 2 §D.2: the quota check and the insert run inside the scope lock,
      // so parallel creates against one scope quota admit exactly the quota.
      // Callers must not hold the scope lock across service calls (no nesting).
      return deps.sessions.withScopeLock(input.storageScopeId, async (locked) => {
        const open = await locked.countOpen(input.storageScopeId, input.ownerId);
        if (open >= options.maxSessionsPerPrincipal) {
          emit({ name: 'upload_quota_refusals', labels: { reason: 'open_session_quota' } });
          throw new Error(`open upload session quota exceeded for principal (max ${options.maxSessionsPerPrincipal})`);
        }
        if (options.stagingQuotaBytesPerScope !== undefined) {
          const reserved = await locked.sumOpenMaxSize(input.storageScopeId) +
            await locked.sumStagedBytesByScope(input.storageScopeId);
          if (reserved + maxSize > options.stagingQuotaBytesPerScope) {
            emit({ name: 'upload_quota_refusals', labels: { reason: 'scope_staging_quota' } });
            throw new Error(`scope staging quota exceeded (max ${options.stagingQuotaBytesPerScope} bytes)`);
          }
        }
        if (input.pageSessionId !== undefined) {
          const pageCount = (await locked.listPageSessions(input.pageSessionId)).length;
          if (pageCount >= input.pageFileLimit!) {
            emit({ name: 'upload_quota_refusals', labels: { reason: 'page_file_quota' } });
            throw new Error(`open upload page file quota exceeded (max ${input.pageFileLimit})`);
          }
        }
        const uploadId = ids();
        const createdAt = now().toISOString();
        const expiresAt = new Date(now().getTime() + UPLOAD_SESSION_TTL_MS).toISOString();
        const key = stagingKey(input.storageScopeId, uploadId);
        await locked.create({
          uploadId, artifactId: input.artifactId, storageScopeId: input.storageScopeId,
          ownerId: input.ownerId, mimeType: input.mimeType, maxSize, state: 'open', expiresAt, createdAt,
          ...(input.pageSessionId === undefined ? {} : { pageSessionId: input.pageSessionId }),
        });
        emit({ name: 'upload_sessions_created' });
      // The signature binds content-type and the EXACT declared Content-Length
      // (a presigned PUT cannot carry a content-length range). The digest is
      // declared at commit, so no checksum header is signed or announced;
      // commit re-verifies size, digest and MIME server-side, fail-closed.
      const signed = await deps.signer.signPut({
        key, contentType: input.mimeType, contentLength: maxSize, expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      });
        return {
          uploadId, uploadUrl: signed.url, method: signed.method, expiresAt: signed.expiresAt, maxSize,
          requiredHeaders: signed.headers,
          stagingKey: key,
        };
      });
    },
    sessionForCommit(input) {
      return deps.sessions.get(input.uploadId).then((session) => {
        if (session === undefined || session.artifactId !== input.artifactId ||
          session.storageScopeId !== input.storageScopeId || session.ownerId !== input.ownerId) {
          throw new UploadVerificationError('unknown_upload', input.uploadId,
            `unknown upload for this artifact/owner/scope: ${input.uploadId}`);
        }
        if (session.state !== 'open') {
          throw new UploadVerificationError('session_not_open', input.uploadId,
            `upload not open (${session.state}): ${input.uploadId}`);
        }
        if (new Date(session.expiresAt).getTime() <= now().getTime()) {
          throw new UploadVerificationError('session_expired', input.uploadId,
            `upload session expired: ${input.uploadId}`);
        }
        return session;
      });
    },
    verifyStaged(session, bytes, expected) {
      if (bytes.length !== expected.size) {
        throw new UploadVerificationError('size_mismatch', session.uploadId,
          `upload size mismatch for ${session.uploadId}: staged ${bytes.length}, declared ${expected.size}`);
      }
      const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      if (actual !== expected.digest) {
        throw new UploadVerificationError('digest_mismatch', session.uploadId,
          `upload digest mismatch for ${session.uploadId}: staged ${actual}`);
      }
      if (expected.mimeType !== session.mimeType) {
        throw new UploadVerificationError('mime_mismatch', session.uploadId,
          `upload MIME mismatch for ${session.uploadId}: session ${session.mimeType}, declared ${expected.mimeType}`);
      }
      try {
        validateFileBytes(expected.mimeType, bytes);
      } catch (error) {
        throw new UploadVerificationError('mime_mismatch', session.uploadId,
          `upload content mismatch for ${session.uploadId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    async completeCommit(session, record) {
      const staged: StagedFileRecord = {
        uploadId: session.uploadId, artifactId: session.artifactId, createdAt: now().toISOString(),
        path: record.path, mimeType: record.mimeType, digest: record.digest, size: record.size,
        ...(session.pageSessionId === undefined ? {} : { pageSessionId: session.pageSessionId }),
      };
      await deps.sessions.recordStagedFile(staged);
      await deps.sessions.markCommitted(session.uploadId);
      return staged;
    },
  };
}

/**
 * Files parity LOT 2 — shared commit core for both channels (agent MCP and
 * browser page). Verification and pin logic live here once: the MCP handler
 * and the page service both call it, so neither duplicates the other.
 */
export interface CommitStagedUploadDeps {
  sessions: UploadSessionStore;
  staging: StagingStore;
  blobs: PublicationBlobStore;
  refs: RefcountStore;
  /** Per-artifact staged caps (`releaseFilesMax`/`releaseTotalBytesMax`). */
  budget: { filesMax: number; totalBytesMax: number };
  metrics?: ArtifactsMetrics;
}

export interface CommitStagedUploadInput extends CommitUploadInput {
  pageSessionId?: string;
}

export async function commitStagedUpload(service: UploadService, deps: CommitStagedUploadDeps,
  input: CommitStagedUploadInput, channel = 'agent'): Promise<StagedFileRecord> {
  const emit = (event: { name: string; labels?: Record<string, string>; value?: number }): void => {
    if (deps.metrics !== undefined) deps.metrics.emit({ ...event,
      labels: { channel, ...(event.labels ?? {}) } });
  };
  const fail = (error: unknown): never => {
    if (error instanceof UploadVerificationError ||
      !(error instanceof Error) || !/budget exceeded/.test(error.message)) {
      emit({ name: 'upload_commits', labels: { result: 'verification_failed' } });
    }
    throw error;
  };
  // Fail-closed cleanup: a verification failure deletes the staged object and
  // closes the session, so a poisoned upload can never be retried into a
  // release and no declaration oracle survives. Best-effort: the refusal is
  // what matters; cleanup failures never mask it.
  const quarantine = async (uploadId: string, stagingKeyToDelete: string | undefined): Promise<void> => {
    if (stagingKeyToDelete !== undefined) {
      await deps.staging.delete(stagingKeyToDelete).catch(() => undefined);
    }
    await deps.sessions.markExpired(uploadId).catch(() => undefined);
  };
  const session = await service.sessionForCommit(input).catch((error) => fail(error));
  const key = stagingKey(input.storageScopeId, input.uploadId);
  const bytes = await deps.staging.get(key);
  if (bytes === undefined) {
    const error = new UploadVerificationError('staged_missing', input.uploadId,
      `staged object missing for ${input.uploadId}`);
    emit({ name: 'upload_commits', labels: { result: 'verification_failed' } });
    await quarantine(input.uploadId, undefined);
    throw error;
  }
  try {
    service.verifyStaged(session, bytes, { digest: input.digest, size: input.size, mimeType: input.mimeType });
  } catch (error) {
    if (error instanceof UploadVerificationError) {
      emit({ name: 'upload_commits', labels: { result: 'verification_failed' } });
      await quarantine(input.uploadId, key);
    } else {
      fail(error);
    }
    throw error;
  }
  // LOT 2 §D.2: per-artifact staged caps, checked at commit for both channels.
  const existing = await deps.sessions.listStagedFiles(input.artifactId);
  const stagedBytes = existing.reduce((total, record) => total + record.size, 0);
  if (existing.length + 1 > deps.budget.filesMax || stagedBytes + input.size > deps.budget.totalBytesMax) {
    emit({ name: 'upload_quota_refusals', labels: { reason: 'staged_budget' } });
    throw new Error(`staged file budget exceeded for artifact (max ${deps.budget.filesMax} files, ` +
      `${deps.budget.totalBytesMax} bytes total)`);
  }
  const casKey = casBlobKey(input.storageScopeId, input.digest);
  await deps.blobs.putBlob(casKey, bytes);
  const readBack = await deps.blobs.getBlob(casKey);
  if (readBack === undefined || readBack.byteLength !== input.size ||
    `sha256:${createHash('sha256').update(readBack).digest('hex')}` !== input.digest) {
    const error = new UploadVerificationError('cas_readback_mismatch', input.uploadId,
      `CAS read-back mismatch for ${input.uploadId}`);
    emit({ name: 'upload_commits', labels: { result: 'verification_failed' } });
    await deps.blobs.deleteBlob(casKey).catch(() => undefined);
    await quarantine(input.uploadId, key);
    throw error;
  }
  const pinReason = `upload:${input.uploadId}`;
  await deps.refs.pin(input.digest, pinReason);
  let staged: StagedFileRecord;
  try {
    staged = await service.completeCommit(session, { path: input.path, mimeType: input.mimeType,
      digest: input.digest, size: input.size });
  } catch (error) {
    await deps.refs.unpin(input.digest, pinReason).catch(() => undefined);
    throw error;
  }
  await deps.staging.delete(key);
  emit({ name: 'upload_commits', labels: { result: 'ok' } });
  emit({ name: 'upload_bytes_committed', value: input.size });
  return staged;
}
