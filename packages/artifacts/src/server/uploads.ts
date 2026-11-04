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
 * SigV4 note (review finding 3): a presigned PUT cannot carry a
 * content-length RANGE (that exists only in POST policies), so the signature
 * binds an EXACT Content-Length (the declared size) plus the checksum header
 * (`x-amz-checksum-sha256`) whenever the digest is known at signing time;
 * S3 itself rejects a PUT whose signed headers do not match. The digest is
 * declared at commit, so the create-time signature binds content-type +
 * exact content-length, the PUT must carry `x-amz-checksum-sha256` (S3
 * validates it against the body, BadDigest on mismatch), and commit
 * re-verifies size and digest server-side before pinning. Residual exposure
 * of a leaked URL is bounded by the declared size (≤ 16 MiB), the
 * per-principal open-session quota and the enforced sweeper (gc.ts).
 *
 * Sessions are durable rows (migration 0007 ALTERs `artifacts.uploads`);
 * the byte store, session store and signer are injected ports — the memory
 * doubles serve unit tests, the S3 adapter serves the host.
 */
import { createHash } from 'node:crypto';
import { validateFileBytes } from './mime.js';
import type { ArtifactsMetrics } from './metrics.js';

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
  /** LOT 2 §D.2: serialize the quota check and insert per scope (race-proof backstop). */
  withScopeLock<T>(storageScopeId: string, action: () => Promise<T>): Promise<T>;
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
 * Presigner port. The signature binds content-type, the EXACT content-length
 * (declared size) and, when known at signing time, x-amz-checksum-sha256;
 * no content-length range exists in a SigV4 presigned PUT (review finding 3).
 */
export interface UploadSignerPort {
  signPut(input: {
    key: string;
    contentType: string;
    contentLength: number;
    /** Canonical `sha256:<hex>` digest, when known at signing time. */
    checksumSha256?: string;
    expiresInSeconds: number;
  }): Promise<{
    url: string;
    method: 'PUT';
    /** Headers the client must send with exactly these values. */
    headers: Record<string, string>;
    expiresAt: string;
  }>;
}

export const STAGING_KEY_PATTERN = /^artifacts\/[A-Za-z0-9_-]+\/staging\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Staging key of one upload session. */
export function stagingKey(storageScopeId: string, uploadId: string): string {
  return `artifacts/${storageScopeId}/staging/${uploadId}`;
}

/**
 * Value of the `x-amz-checksum-sha256` header for a canonical `sha256:<hex>`
 * digest: S3 expects the base64 of the raw digest bytes (no `sha256:` prefix).
 */
export function checksumHeaderValue(digest: string): string {
  const match = /^sha256:([0-9a-f]{64})$/.exec(digest);
  if (match === null) throw new Error(`invalid sha256 digest: ${digest}`);
  return Buffer.from(match[1], 'hex').toString('base64');
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
  const withScopeLock = <T>(storageScopeId: string, action: () => Promise<T>): Promise<T> => {
    const previous = scopeTails.get(storageScopeId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    scopeTails.set(storageScopeId, previous.then(() => gate));
    return previous.then(action).finally(release);
  };
  const scopeOfStaged = (record: StagedFileRecord): string | undefined =>
    sessions.get(record.uploadId)?.storageScopeId;
  return {
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
    withScopeLock,
    listExpiredStaged(at, ttlMs) {
      return Promise.resolve([...stagedFiles.values()].filter((record) =>
        new Date(record.createdAt).getTime() + ttlMs <= at.getTime()));
    },
    deleteStagedFile(uploadId) {
      stagedFiles.delete(uploadId);
      return Promise.resolve();
    },
  };
}

/**
 * Memory signer double: records every signed PUT and simulates S3's
 * enforcement of the signed headers (exact content-length equality) and of
 * the checksum header (body must hash to it when present).
 */
export function createMemoryUploadSigner() {
  const signed: {
    key: string; contentType: string; contentLength: number;
    checksumSha256?: string; expiresAt: string; url: string;
  }[] = [];
  const signer: UploadSignerPort = {
    signPut(input) {
      assertStagingKey(input.key);
      if (!Number.isSafeInteger(input.contentLength) || input.contentLength < 0) {
        throw new Error('invalid signed content-length');
      }
      const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000).toISOString();
      const url = `https://s3.test/${input.key}?X-Amz-Signature=mem-${signed.length}`;
      const checksumHeader = input.checksumSha256 === undefined ? undefined : checksumHeaderValue(input.checksumSha256);
      signed.push({ key: input.key, contentType: input.contentType, contentLength: input.contentLength,
        ...(checksumHeader === undefined ? {} : { checksumSha256: checksumHeader }),
        expiresAt, url });
      return Promise.resolve({
        url,
        method: 'PUT' as const,
        headers: {
          'content-type': input.contentType,
          'content-length': String(input.contentLength),
          ...(checksumHeader === undefined ? {} : { 'x-amz-checksum-sha256': checksumHeader }),
        },
        expiresAt,
      });
    },
  };
  return {
    signer,
    signed,
    /** Simulate the client PUT against "S3": signed headers are enforced exactly. */
    put(signedPut: { key: string; contentType: string; contentLength: number; checksumSha256?: string },
      bytes: Uint8Array, headers: Record<string, string>): void {
      if (String(bytes.length) !== headers['content-length'] || bytes.length !== signedPut.contentLength) {
        throw new Error(`content-length mismatch: signed ${signedPut.contentLength}, body ${bytes.length}`);
      }
      if (headers['content-type'] !== signedPut.contentType) {
        throw new Error('content-type mismatch with the signed header');
      }
      if (signedPut.checksumSha256 !== undefined && headers['x-amz-checksum-sha256'] !== signedPut.checksumSha256) {
        throw new Error('x-amz-checksum-sha256 mismatch with the signed header');
      }
      if (headers['x-amz-checksum-sha256'] !== undefined &&
        createHash('sha256').update(bytes).digest('base64') !== headers['x-amz-checksum-sha256']) {
        throw new Error('BadDigest: body does not match x-amz-checksum-sha256');
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
}

export interface CreateUploadResult {
  uploadId: string;
  uploadUrl: string;
  method: 'PUT';
  /** Presigned-URL expiry (≤ 10 minutes). */
  expiresAt: string;
  maxSize: number;
  /** Headers the client must send with exactly these values (bound by the signature). */
  requiredHeaders: Record<string, string>;
  /**
   * The PUT must also carry this header with the base64 SHA-256 of the body;
   * S3 validates it against the body (BadDigest on mismatch) and commit
   * re-verifies size and digest server-side.
   */
  checksumHeader: 'x-amz-checksum-sha256';
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
  return {
    async create(input) {
      if (input.maxSize !== undefined && (!Number.isSafeInteger(input.maxSize) || input.maxSize < 1)) {
        throw new Error('invalid upload byte budget');
      }
      const open = await deps.sessions.countOpen(input.storageScopeId, input.ownerId);
      if (open >= options.maxSessionsPerPrincipal) {
        throw new Error(`open upload session quota exceeded for principal (max ${options.maxSessionsPerPrincipal})`);
      }
      const maxSize = Math.min(input.maxSize ?? options.maxUploadBytes, options.maxUploadBytes);
      const uploadId = ids();
      const createdAt = now().toISOString();
      const expiresAt = new Date(now().getTime() + UPLOAD_SESSION_TTL_MS).toISOString();
      const key = stagingKey(input.storageScopeId, uploadId);
      await deps.sessions.create({
        uploadId, artifactId: input.artifactId, storageScopeId: input.storageScopeId,
        ownerId: input.ownerId, mimeType: input.mimeType, maxSize, state: 'open', expiresAt, createdAt,
      });
      // The signature binds content-type and the EXACT declared Content-Length
      // (a presigned PUT cannot carry a content-length range). The digest is
      // declared at commit, so the PUT must also carry x-amz-checksum-sha256,
      // which S3 validates against the body; commit re-verifies both.
      const signed = await deps.signer.signPut({
        key, contentType: input.mimeType, contentLength: maxSize, expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      });
      return {
        uploadId, uploadUrl: signed.url, method: signed.method, expiresAt: signed.expiresAt, maxSize,
        requiredHeaders: signed.headers, checksumHeader: 'x-amz-checksum-sha256',
        stagingKey: key,
      };
    },
    sessionForCommit(input) {
      return deps.sessions.get(input.uploadId).then((session) => {
        if (session === undefined || session.artifactId !== input.artifactId ||
          session.storageScopeId !== input.storageScopeId || session.ownerId !== input.ownerId) {
          throw new Error(`unknown upload for this artifact/owner/scope: ${input.uploadId}`);
        }
        if (session.state !== 'open') throw new Error(`upload not open (${session.state}): ${input.uploadId}`);
        if (new Date(session.expiresAt).getTime() <= now().getTime()) {
          throw new Error(`upload session expired: ${input.uploadId}`);
        }
        return session;
      });
    },
    verifyStaged(session, bytes, expected) {
      if (bytes.length !== expected.size) {
        throw new Error(`upload size mismatch for ${session.uploadId}: staged ${bytes.length}, declared ${expected.size}`);
      }
      const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      if (actual !== expected.digest) {
        throw new Error(`upload digest mismatch for ${session.uploadId}: staged ${actual}`);
      }
      if (expected.mimeType !== session.mimeType) {
        throw new Error(`upload MIME mismatch for ${session.uploadId}: session ${session.mimeType}, declared ${expected.mimeType}`);
      }
      validateFileBytes(expected.mimeType, bytes);
    },
    async completeCommit(session, record) {
      const staged: StagedFileRecord = {
        uploadId: session.uploadId, artifactId: session.artifactId, createdAt: now().toISOString(),
        path: record.path, mimeType: record.mimeType, digest: record.digest, size: record.size,
      };
      await deps.sessions.recordStagedFile(staged);
      await deps.sessions.markCommitted(session.uploadId);
      return staged;
    },
  };
}
