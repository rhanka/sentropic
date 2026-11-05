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

/**
 * J1.1a — browser fallback MIME by extension for the upload page, used only
 * when the browser reports no `File.type`: `.geojson` as `application/json`,
 * `.mjs` as `text/javascript`, `.woff2` as `font/woff2`, plus owner-kept
 * `.wasm` and `.pbf`. Rendered into the page as JSON.
 */
export const BROWSER_EXTENSION_FALLBACK_MIME: Readonly<Record<string, string>> = Object.freeze({
  geojson: 'application/json',
  mjs: 'text/javascript',
  woff2: 'font/woff2',
  wasm: 'application/wasm',
  pbf: 'application/x-protobuf',
  avif: 'image/avif',
  ico: 'image/x-icon',
});

/**
 * Self-contained static upload page (no external assets). Bytes travel
 * browser → S3 via raw PUT (FormData is banned: multipart wrapping changes
 * length and type); one session per file with `size = File.size`; at most 4
 * PUTs in flight; commit each file before opening further sessions.
 */
export function renderUploadPage(options: { s3Origins: readonly string[] }): string {
  const csp = uploadPageCsp(options.s3Origins);
  const config = JSON.stringify({ s3Origins: [...options.s3Origins] });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, '&quot;')}">
<meta name="color-scheme" content="light dark">
<title>Upload files</title>
<style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem}
#drop{border:2px dashed #888;border-radius:.5rem;padding:2rem;text-align:center;margin:1rem 0}
#drop.over{border-color:#06c;background:#06c1}
li{margin:.25rem 0;font-size:.9rem}pre{white-space:pre-wrap;word-break:break-all;background:#8882;padding:1rem}</style>
</head>
<body>
<h1>Upload files</h1>
<p>Pick files from your disk. They upload straight to object storage; the assistant never sees the bytes.
When every file shows <b>staged</b>, go back to the chat and say <b>done</b>.</p>
<div id="drop">Drop files or folders here, paste an image, or
<input id="picker" type="file" multiple> <input id="folder" type="file" webkitdirectory></div>
<ul id="files"></ul>
<button id="copy" type="button">Copy asset list (chat fallback)</button>
<pre id="assetJson" hidden></pre>
<p id="error" role="alert"></p>
<script>window.__ARTIFACTS_UPLOAD__ = ${config};</script>
<script>
'use strict';
const sessionId = location.pathname.split('/').filter(Boolean).pop();
let token = (location.hash.match(/#t=([^&]+)/) || [])[1] || '';
const filesEl = document.getElementById('files');
const errorEl = document.getElementById('error');
const fail = (message) => { errorEl.textContent = String(message); };
if (!sessionId || !token) fail('This upload link is incomplete. Ask the assistant for a fresh one.');
const base = location.pathname.replace(/\\/+$/, '').replace(/artifacts\\/upload\\/[^/]+$/, 'artifacts/upload/' + sessionId);
const api = async (path, body, method) => {
  const response = await fetch(base + '/' + path, { method: method || 'POST',
    headers: { 'content-type': 'application/json', 'x-artifact-upload': '1' },
    body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  if (!response.ok) throw new Error(path + ' failed: ' + response.status);
  return response.json();
};
const EXT_TYPES = ${JSON.stringify(BROWSER_EXTENSION_FALLBACK_MIME)};
const chunked = (bytes, f) => {
  const view = new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < view.length; i += 0x8000) out += f(view.subarray(i, i + 0x8000)));
  return out;
};
const hex = (bytes) => chunked(bytes, (part) => [...part].map((b) => b.toString(16).padStart(2, '0')).join(''));
const row = (path) => {
  const li = document.createElement('li');
  li.textContent = path + ': queued';
  filesEl.appendChild(li);
  return (text) => { li.textContent = path + ': ' + text; };
};
async function stage(file, relPath) {
  const setStatus = row(relPath);
  const ext = (relPath.split('.').pop() || '').toLowerCase();
  const mimeType = file.type || EXT_TYPES[ext] || 'application/octet-stream';
  const created = await api('files', { path: relPath, mimeType, size: file.size });
  setStatus('uploading');
  const buffer = await file.arrayBuffer();
  const put = async (upload) => fetch(upload.uploadUrl, { method: 'PUT', body: file,
    headers: { 'content-type': upload.requiredHeaders['content-type'] } });
  let upload = created;
  let response = await put(upload);
  if (!response.ok) {
    upload = await api('files', { path: relPath, mimeType, size: file.size });
    response = await put(upload);
  }
  if (!response.ok) throw new Error('PUT failed: ' + response.status);
  setStatus('committing');
  const digest = 'sha256:' + hex(await crypto.subtle.digest('SHA-256', buffer));
  try {
    await api('files/' + upload.uploadId + '/commit', { path: relPath, mimeType, digest,
      size: file.size, idempotencyKey: crypto.randomUUID() });
  } catch (error) {
    const renamed = prompt('That path is already staged. Enter a new path, or cancel to skip:', relPath);
    if (!renamed) throw error;
    await api('files/' + upload.uploadId + '/commit', { path: renamed, mimeType, digest,
      size: file.size, idempotencyKey: crypto.randomUUID() });
  }
  setStatus('staged');
}
async function runAll(entries) {
  const workers = [];
  const queue = [...entries];
  for (let i = 0; i < 4; i += 1) {
    workers.push((async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        try { await stage(next.file, next.path); }
        catch (error) { row(next.path)(String(error && error.message || error)); }
      }
    })());
  }
  await Promise.all(workers);
}
const collect = (list) => [...list].map((file) => ({ file,
  path: file.webkitRelativePath || file.name }));
document.getElementById('picker').addEventListener('change', (event) => { runAll(collect(event.target.files)); });
document.getElementById('folder').addEventListener('change', (event) => { runAll(collect(event.target.files)); });
const drop = document.getElementById('drop');
drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (event) => {
  event.preventDefault();
  drop.classList.remove('over');
  runAll(collect(event.dataTransfer.files));
});
document.addEventListener('paste', (event) => {
  const images = [...(event.clipboardData ? event.clipboardData.files : [])]
    .filter((file) => file.type.startsWith('image/'));
  if (images.length > 0) runAll(collect(images));
});
document.getElementById('copy').addEventListener('click', async () => {
  const staged = await api('files', undefined, 'GET');
  const pre = document.getElementById('assetJson');
  pre.hidden = false;
  pre.textContent = JSON.stringify(staged, null, 2);
});
api('exchange', { token }).then(() => {
  history.replaceState(null, '', location.pathname);
  token = '';
}).catch(fail);
</script>
</body>
</html>`;
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
    stagingKey: string }>;
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
    async createFile(input) {
      const row = await checkPageRequest(input);
      checkPath(input.path);
      if (!deps.profile.mimeTypes.includes(input.mimeType)) throw new Error('unsupported page MIME type');
      if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > deps.profile.maxFileBytes) {
        throw new Error('invalid page file size');
      }
      return uploads.create({ artifactId: row.artifactId, storageScopeId: row.storageScopeId,
        ownerId: row.ownerId, mimeType: input.mimeType, maxSize: input.size,
        pageSessionId: row.pageSessionId, pageFileLimit: row.maxFiles });
    },
    async commitFile(input) {
      const row = await checkPageRequest(input);
      checkPath(input.path);
      if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.trim().length === 0 ||
        input.idempotencyKey.length > 256) {
        throw new Error('invalid page idempotency key');
      }
      const commit = { uploadId: input.uploadId, artifactId: row.artifactId,
        storageScopeId: row.storageScopeId, ownerId: row.ownerId, path: input.path,
        mimeType: input.mimeType, digest: input.digest, size: input.size };
      const paramsHash = createHash('sha256').update(JSON.stringify(commit), 'utf8').digest('hex');
      const work = (): Promise<StagedFileRecord> => commitStagedUpload(uploads,
        { sessions: deps.sessions, staging: deps.staging, blobs: deps.blobs, refs: deps.refs,
          budget: deps.budget, metrics: deps.metrics }, commit, 'browser');
      if (deps.idempotency === undefined) return work();
      const storeKey = JSON.stringify(['commit_upload', row.ownerId, input.idempotencyKey]);
      try {
        const { result } = await deps.idempotency.execute(storeKey, paramsHash, work);
        return result as StagedFileRecord;
      } catch (cause) {
        if (cause instanceof Error && /idempotency conflict/.test(cause.message)) throw cause;
        throw cause;
      }
    },
    async listStaged(input) {
      const row = await checkPageRequest(input);
      return (await deps.sessions.listStagedFiles(row.artifactId))
        .filter((record) => record.pageSessionId === row.pageSessionId);
    },
  };
}
