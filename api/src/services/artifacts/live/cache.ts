import { createHmac, timingSafeEqual } from 'node:crypto';
import { safeDependencyPath, sha256, verifySri, type IntegrityPin } from './integrity';
import { integrityEvidence, qualifyBuild, type Gb1Source } from './gb1-qualification';
import { defaultInstallBudget, defaultSealBudget, withinInstallBudget, INSTALL_CACHE_ADMIT_TIMEOUT_MS,
  INSTALL_CACHE_LOOKUP_TIMEOUT_MS, runInstallStep, type InstallBudget, type InstallProgress,
  type InstallStepLogger, type PhaseEventsContext } from './deadline';
import { LiveError, type LiveRuntime } from './records';
import { BUILDER_IMAGE, INSTALL_RECIPE, NPM_RELAY, installRecipeFor } from './recipes';
import { subsetLockPaths, validateWorkspaces } from './workspace-subset';
import { extractTarZst, tarZst, TREE_LIMITS, type TransferFailure } from './supervisor-transfer';
import { sealedArchiveRef, tarballRef } from './cache-storage';

export interface CacheIdentity {
  storageScopeId: string; repoId: string; lockSha256: string; platform: string;
  nodeVersion: string; npmVersion: string; image: string; policyRevision: string;
  workspaceTopology: string; integrityDigest: string;
  /** Workspace-scoped installs (sorted, empty means the whole lockfile). Part of the cache key. */
  installWorkspaces: readonly string[];
}
/** One regular dependency file of a sealed manifest; its bytes are one private object addressed by their sha256. */
export interface DependencyEntry { path: string; mode: 292 | 365; size: number; sha256: string }
export interface DependencyFile { path: string; mode: 292 | 365; bytes: Uint8Array }
export interface CacheReceipt {
  key: string; identity: CacheIdentity; treeSha256: string; inventory: readonly IntegrityPin[];
  runId: string; installOptions: typeof INSTALL_RECIPE; seal: string;
  /** Sealed-unit pointer (§7.1.2): the one `tar.zst` archive admitted with this receipt. Absent on entries
   * sealed before L1 (transition dual-read) and on seals produced without archive support (rollback). */
  archive?: { ref: string; sha256: string; bytes: number };
  /** Sealed file count (manifest rows) for telemetry (§7.1.3): inventory length counts tarballs, not files. */
  files?: number;
}
export interface CacheObject { receipt: CacheReceipt; manifest: readonly DependencyEntry[] }
/** Lookup-only source of `requireSealed`: the lockfile, its cache identity and the GB1 inputs. No staging
 * reference and no runtime: the user path never installs. */
export interface SealedSource { lockfile: Uint8Array; cacheIdentity: CacheIdentity; gb1: Gb1Source }
/** User-path bound of one sealed-cache lookup (Postgres SELECT + one manifest GET): 5 s. A lookup has no
 * business exceeding it, and exceeding it is a typed `builder_unavailable:cache_lookup_timeout` — an SLO
 * defect signal on this path, never an install. Replaces the 120 s `INSTALL_CACHE_LOOKUP_TIMEOUT_MS` bound
 * on every path that migrated to `requireSealed` (§7.1.1). */
export const SEALED_LOOKUP_TIMEOUT_MS = 5_000;
/** Seal tarball prefetch window (§7.1.6): up to 8 verified tarballs in flight, admitted in lock order. */
export const SEAL_PREFETCH_WINDOW = 8;
/** Kill-switch of the L1 sealed user path (default on): `0` keeps the legacy inline-install `acquire` on
 * user paths (§11 rollback shape). New behavior ships enabled; the old path stays implemented one release. */
export const sealedUserPathEnabled = (env: Readonly<Record<string, string | undefined>> = process.env) =>
  (env.ARTIFACT_BUILDER_SEALED_CACHE ?? '1') !== '0';
export interface CachePorts {
  signingKey(): Uint8Array;
  /** Lookup-only sealed-cache read (§7.1.1): sealed hit returns the verified receipt; miss or corrupt entry
   * throws `cache_not_prewarmed`. Optional so older fakes keep compiling: `requireUserCache` falls back
   * to `acquire` when it is absent. */
  requireSealed?(source: SealedSource): Promise<CacheReceipt>;
  /** Downloads exact pinned tarballs through this relay; redirects/alternate registries are forbidden. The watchdog
   * aborts `signal` on a cut install so a hung fetch stops instead of holding the relay. */
  fetch(pin: IntegrityPin, relay: typeof NPM_RELAY, signal?: AbortSignal): Promise<Uint8Array>;
  /** Fresh empty install directory, fixed npm config, verified tarballs read one at a time, no branch .npmrc or hooks.
   * Each installed regular file goes to `sink` as soon as it is read, so neither side holds the whole tree. The
   * optional `progress` feeds the install watchdog: report every streamed tarball and drained file, and suspend the
   * stall timer across the opaque offline `npm ci` sub-phase (still covered by the ceiling). The watchdog aborts
   * `signal` on a cut install; the installer stops at the next frame or file and never admits. */
  cleanInstall(input: { lockfile: Uint8Array; identity: CacheIdentity; recipe: typeof INSTALL_RECIPE;
    stagingRef: string; runtime?: LiveRuntime; tarballs: AsyncIterable<{ pin: IntegrityPin; bytes: Uint8Array }>;
    sink(file: DependencyFile): Promise<void>; progress?: InstallProgress; signal?: AbortSignal }): Promise<{ runId: string }>;
  storage: {
    read(key: string): Promise<CacheObject | undefined>;
    /** Atomic immutable create: partial entries are invisible; returns the winning complete object. */
    admit(key: string, object: CacheObject): Promise<CacheObject>;
    quarantine(key: string): Promise<void>;
    /** Content-addressed file objects shared by every entry; `getFile` returns stored bytes that the cache rehashes. */
    putFile(sha256: string, bytes: Uint8Array): Promise<void>;
    getFile(sha256: string): Promise<Uint8Array | undefined>;
    /** Sealed-unit archive of one entry (`sealedArchiveRef`); `getArchive` returns bytes the cache re-verifies. */
    putArchive(ref: string, bytes: Uint8Array): Promise<void>;
    getArchive(ref: string): Promise<Uint8Array | undefined>;
    /** Source unit of one commit (`sourceUnitRef`); the forge reader's repacked snapshot (§7.2.2). */
    putSource(ref: string, bytes: Uint8Array): Promise<void>;
    getSource(ref: string): Promise<Uint8Array | undefined>;
    /** Verified tarball store (`tarballRef`); content-addressed by SRI, reused by every seal (§7.1.6). */
    putTarball(ref: string, bytes: Uint8Array): Promise<void>;
    getTarball(ref: string): Promise<Uint8Array | undefined>;
  };
}
function invalid(): never { throw new LiveError('dependency_cache_invalid'); }
/** GB1 qualification and workspace-subset selection shared by `acquire` (user + prewarm fallback) and
 * `requireSealed`/`seal` (L1 split): identity checks first, then the reachable subset over the validated lock. */
function qualifiedInventory(source: { lockfile: Uint8Array; cacheIdentity: CacheIdentity; gb1: Gb1Source }) {
  const identity = source.cacheIdentity;
  if (identity.image !== BUILDER_IMAGE || sha256(source.lockfile) !== identity.lockSha256) invalid();
  // GB1 at the pinned commit (W5 port); the qualification file digest is the identity's integrity digest.
  const evidence = integrityEvidence(qualifyBuild(source.gb1));
  if (evidence.lockSha256 !== identity.lockSha256 || evidence.digest !== identity.integrityDigest) invalid();
  // Workspace subset after the full-lock qualification above: the lock stays validated whole (every remote
  // entry still needs literal SRI or the sealed map), then only the reachable subset is fetched and installed.
  const selection = [...(identity.installWorkspaces ?? [])].sort();
  let inventory = evidence.inventory;
  if (selection.length > 0) {
    const lockText = Buffer.from(source.lockfile).toString('utf8');
    const files = source.gb1.files as Record<string, string>;
    const rootManifest = files['package.json'];
    if (typeof rootManifest !== 'string') invalid();
    const validated = validateWorkspaces(selection, rootManifest,
      Object.keys(files).filter(path => path === 'package.json' || path.endsWith('/package.json')));
    const keep = subsetLockPaths(lockText, validated);
    inventory = evidence.inventory.filter(pin => keep.has(pin.path));
  }
  return { identity, inventory, recipe: installRecipeFor(selection), key: cacheKey(identity) };
}
/** User-path cache surface: the lookup-only `requireSealed` (L1, when implemented and enabled) with the
 * legacy inline-install `acquire` as the §11 rollback fallback. Structural so `LivePorts['cache']` fits
 * without importing the ports (which import these cache types). */
export interface UserCache {
  acquire(source: { lockfile: Uint8Array; cacheIdentity: CacheIdentity; stagingRef: string; gb1: Gb1Source },
    runtime?: LiveRuntime): Promise<CacheReceipt>;
  requireSealed?(source: SealedSource, options?: { events?: PhaseEventsContext & { artifactId?: string } }): Promise<CacheReceipt>;
}
/** User-path cache entry point (§7.1.1, §7.1.4): `requireSealed` when the cache implements it and the L1
 * path is enabled, otherwise the legacy inline-install `acquire` (§11 rollback shape). */
export async function requireUserCache(cache: UserCache,
  source: { lockfile: Uint8Array; cacheIdentity: CacheIdentity; stagingRef: string; gb1: Gb1Source },
  runtime?: LiveRuntime, options: { events?: PhaseEventsContext & { artifactId?: string } } = {}) {
  if (sealedUserPathEnabled() && cache.requireSealed) return cache.requireSealed(source, options);
  return cache.acquire(source, runtime);
}
const cacheKey = (id: CacheIdentity) => `${id.lockSha256}/${sha256(JSON.stringify([
  id.storageScopeId, id.repoId, id.platform, id.nodeVersion, id.npmVersion, id.image,
  id.policyRevision, id.workspaceTopology, id.integrityDigest, [...(id.installWorkspaces ?? [])].sort(),
]))}`;
/** Canonical sealed-cache key of an identity (§7.1.2): the prewarm state rows and archive refs key off this. */
export const cacheKeyOf = (identity: CacheIdentity): string => cacheKey(identity);
const DIGEST = /^[a-f0-9]{64}$/;
/** Unchanged tree digest over [path, mode, sha256] rows; a size is bound by the per-file rehash on every read. */
function treeDigest(manifest: readonly DependencyEntry[]) {
  if (!Array.isArray(manifest) || manifest.length > TREE_LIMITS.files) invalid();
  let total = 0;
  const paths = new Set<string>();
  const rows = manifest.map(entry => {
    if (!entry || !safeDependencyPath(entry.path) || paths.has(entry.path) || ![292, 365].includes(entry.mode)
      || !Number.isSafeInteger(entry.size) || entry.size < 0 || typeof entry.sha256 !== 'string' || !DIGEST.test(entry.sha256)) invalid();
    paths.add(entry.path);
    total += entry.size;
    if (entry.size > TREE_LIMITS.fileBytes || total > TREE_LIMITS.totalBytes) invalid();
    return [entry.path, entry.mode, entry.sha256];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  for (const path of paths) {
    const parts = path.split('/'); parts.pop();
    while (parts.length) { if (paths.has(parts.join('/'))) invalid(); parts.pop(); }
  }
  return sha256(JSON.stringify(rows));
}
export function createDependencyCache(ports: CachePorts, budget: InstallBudget = defaultInstallBudget(),
  options: { log?: InstallStepLogger; now?: () => number } = {}) {
  async function read(key: string) {
    try { return await ports.storage.read(key); }
    catch (error) {
      if (error instanceof LiveError && error.code === 'dependency_cache_invalid') await ports.storage.quarantine(key);
      throw error;
    }
  }
  function seal(receipt: Omit<CacheReceipt, 'seal'>) {
    const key = ports.signingKey();
    if (key.byteLength < 32) return invalid();
    return createHmac('sha256', key).update(JSON.stringify(receipt)).digest('hex');
  }
  function verify(object: CacheObject, identity: CacheIdentity) {
    try {
      const { seal: signature, ...receipt } = object.receipt;
      const expected = Buffer.from(seal(receipt));
      const actual = Buffer.from(signature);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)
        || receipt.key !== cacheKey(identity) || cacheKey(receipt.identity) !== cacheKey(identity)
        || treeDigest(object.manifest) !== receipt.treeSha256) invalid();
      return object.receipt;
    } catch { return invalid(); }
  }
  return {
    /** Lookup-only sealed read for user paths (§7.1.1): sealed hit returns the verified receipt; miss or
     * corrupt entry quarantines and throws typed `cache_not_prewarmed` carrying the lockSha256 — never a
     * fetch, never an install, bounded at `SEALED_LOOKUP_TIMEOUT_MS`. */
    async requireSealed(source: SealedSource, sealOptions: { events?: PhaseEventsContext & { artifactId?: string } } = {}) {
      const { identity, key } = qualifiedInventory(source);
      const unsealed = (): never => { throw new LiveError('cache_not_prewarmed', identity.lockSha256); };
      let existing: CacheObject | undefined;
      try {
        existing = await runInstallStep(undefined, 'cache_lookup', () => read(key),
          { timeoutMs: SEALED_LOOKUP_TIMEOUT_MS, log: options.log, now: options.now,
            ...(sealOptions.events ? { events: sealOptions.events } : {}) });
      } catch (error) {
        if (error instanceof LiveError && error.code === 'builder_unavailable') throw error;
        unsealed();
      }
      if (!existing) unsealed();
      try { return verify(existing as CacheObject, identity); }
      catch { await ports.storage.quarantine(key); unsealed(); }
    },
    async acquire(source: { lockfile: Uint8Array; cacheIdentity: CacheIdentity; stagingRef: string; gb1: Gb1Source },
      runtime?: LiveRuntime) {
      return withinInstallBudget(async (progress, signal) => {
        const { identity, inventory, recipe, key } = qualifiedInventory(source);
        const existing = await runInstallStep(progress, 'cache_lookup', () => read(key),
          { timeoutMs: budget.lookupMs ?? INSTALL_CACHE_LOOKUP_TIMEOUT_MS, signal, log: options.log, now: options.now });
        if (existing) {
          try { return verify(existing, identity); }
          catch (error) { await ports.storage.quarantine(key); throw error; }
        }
        /** One verified tarball at a time; an altered one stops the stream before the pod runs the install. */
        async function* tarballs() {
          for (const pin of inventory) {
            const bytes = await ports.fetch(pin, NPM_RELAY, signal);
            verifySri(bytes, pin.integrity);
            progress.report();
            yield { pin, bytes };
          }
        }
        const manifest: DependencyEntry[] = [];
        const sink = async (file: DependencyFile) => {
          if (manifest.length >= TREE_LIMITS.files || !(file.bytes instanceof Uint8Array)) invalid();
          const digest = sha256(file.bytes);
          await ports.storage.putFile(digest, file.bytes);
          manifest.push({ path: file.path, mode: file.mode, size: file.bytes.byteLength, sha256: digest });
          progress.report();
        };
        const installed = await ports.cleanInstall({ ...source, identity, runtime, recipe,
          tarballs: tarballs(), sink, progress, signal });
        if (!installed.runId) invalid();
        const receipt = { key, identity, treeSha256: treeDigest(manifest), inventory,
          runId: installed.runId, installOptions: recipe };
        const object = { receipt: { ...receipt, seal: seal(receipt) }, manifest };
        const admitted = await runInstallStep(progress, 'cache_admit', () => ports.storage.admit(key, object),
          { timeoutMs: budget.admitMs ?? INSTALL_CACHE_ADMIT_TIMEOUT_MS, signal, log: options.log, now: options.now,
            counts: winner => ({ files: winner?.manifest.length ?? 0,
              bytes: (winner?.manifest ?? []).reduce((total, entry) => total + entry.size, 0) }) });
        try {
          verify(admitted, identity);
          if (admitted.receipt.treeSha256 !== receipt.treeSha256) invalid();
        } catch (error) { await ports.storage.quarantine(key); throw error; }
        return admitted.receipt;
      }, budget);
    },
    /** Prewarm-only seal (§7.1.1, §7.1.2): qualifies like `acquire`, then installs once, streams the drained
     * files into one deterministic `tar.zst` (§7.1.2), stores it under the receipt's tree digest and admits
     * `{receipt, manifest, archive}` atomically. Per-file objects are NOT written for new seals (D8): the
     * manifest rows stay readable in the admitted object, the bytes live only in the archive. Never called
     * on a user path — the prewarm job (cache-api) is the only caller, under the prewarm budget. */
    async seal(source: { lockfile: Uint8Array; cacheIdentity: CacheIdentity; stagingRef: string; gb1: Gb1Source;
      runtime?: LiveRuntime }, sealBudget: InstallBudget = defaultSealBudget(),
      sealOptions: { events?: PhaseEventsContext & { artifactId?: string } } = {}) {
      const sealEvents = sealOptions.events ? { events: sealOptions.events } : {};
      return withinInstallBudget(async (progress, signal) => {
        const { identity, inventory, recipe, key } = qualifiedInventory(source);
        const existing = await runInstallStep(progress, 'cache_lookup', () => read(key),
          { timeoutMs: sealBudget.lookupMs ?? INSTALL_CACHE_LOOKUP_TIMEOUT_MS, signal, log: options.log,
            now: options.now, phase: 'seal', ...sealEvents });
        if (existing) {
          try { return verify(existing, identity); }
          catch { await ports.storage.quarantine(key); }
        }
        /** Bounded-parallel tarball prefetch (§7.1.6): up to `SEAL_PREFETCH_WINDOW` verified fetches in
         * flight, yielded in lock order so the pod stream admission stays ordered. Verified tarballs are
         * stored content-addressed (`tarballRef`) on first fetch; later seals reuse the bytes without
         * touching the relay. A store outage fails the seal (the archive admission needs the store anyway);
         * a corrupt store entry refetches from the relay and overwrites it. */
        async function* tarballs() {
          progress.step?.('tarball_fetch');
          // Pulls never reject (results carry the error) so a failure observed in order leaves no unhandled
          // rejection behind in the still-flying window.
          const inFlight = new Map<number, Promise<{ pin: IntegrityPin; bytes: Uint8Array } | { error: unknown }>>();
          const pull = async (index: number) => {
            try {
              const pin = inventory[index]!;
              const stored = await ports.storage.getTarball(tarballRef(pin.integrity));
              if (stored) {
                try {
                  verifySri(stored, pin.integrity);
                  progress.report();
                  return { pin, bytes: stored };
                } catch { /* corrupt store entry: refetch below and overwrite */ }
              }
              const bytes = await ports.fetch(pin, NPM_RELAY, signal);
              verifySri(bytes, pin.integrity);
              await ports.storage.putTarball(tarballRef(pin.integrity), bytes);
              progress.report();
              return { pin, bytes };
            } catch (error) { return { error }; }
          };
          let cursor = 0; let next = 0;
          for (; cursor < Math.min(SEAL_PREFETCH_WINDOW, inventory.length); cursor++) inFlight.set(cursor, pull(cursor));
          while (inFlight.size > 0) {
            const result = await inFlight.get(next)!;
            inFlight.delete(next);
            if (cursor < inventory.length) { inFlight.set(cursor, pull(cursor)); cursor++; }
            next++;
            if ('error' in result) throw result.error;
            yield result;
          }
          progress.clearStep?.();
        }
        // Async channel from the installer sink into the tar stream: the sink resolves at once (no backpressure
        // into the install), the tar consumes concurrently, so only a few files plus the compressor window are held.
        const pending: DependencyFile[] = [];
        const rows: DependencyEntry[] = [];
        let finished = false; let failure: unknown; let wake: (() => void) | undefined;
        const sink = async (file: DependencyFile) => {
          if (failure === undefined && rows.length < TREE_LIMITS.files && file.bytes instanceof Uint8Array) {
            const digest = sha256(file.bytes);
            rows.push({ path: file.path, mode: file.mode, size: file.bytes.byteLength, sha256: digest });
            pending.push(file);
          }
          wake?.(); wake = undefined;
          progress.report();
        };
        async function* stream(): AsyncGenerator<DependencyFile> {
          for (;;) {
            const next = pending.shift();
            if (next) { yield next; continue; }
            // A seal failure ends the tar input instead of throwing through the pipe: throwing across the
            // zstd stream boundary strands the consumer, while a clean end always resolves it. The consumer
            // rethrows `failure` after the truncated tar completes (a truncated tar is never admitted).
            if (failure !== undefined) return;
            if (finished) return;
            await new Promise<void>(resolve => { wake = resolve; });
          }
        }
        const consume = (async () => {
          const chunks: Uint8Array[] = []; let size = 0;
          for await (const chunk of tarZst(stream())) {
            size += chunk.byteLength;
            if (size > TREE_LIMITS.totalBytes) invalid();
            chunks.push(chunk);
          }
          if (failure !== undefined) throw failure;
          return Buffer.concat(chunks);
        })();
        consume.catch(() => undefined);
        let installed: { runId: string };
        try {
          installed = await ports.cleanInstall({ ...source, identity, runtime: source.runtime, recipe,
            tarballs: tarballs(), sink, progress, signal });
          if (!installed.runId) invalid();
        } catch (error) {
          failure = error; wake?.();
          await consume.catch(() => undefined);
          throw error;
        }
        finished = true; wake?.();
        const archiveBytes = await consume;
        const treeSha256 = treeDigest(rows);
        const ref = sealedArchiveRef(key, treeSha256);
        await runInstallStep(progress, 'seal_archive', () => ports.storage.putArchive(ref, archiveBytes),
          { signal, log: options.log, now: options.now, phase: 'seal', ...sealEvents,
            counts: () => ({ files: rows.length, bytes: sizeOf(rows) }) });
        const receipt = { key, identity, treeSha256, inventory, runId: installed.runId, installOptions: recipe,
          archive: { ref, sha256: sha256(archiveBytes), bytes: archiveBytes.byteLength }, files: rows.length };
        const object = { receipt: { ...receipt, seal: seal(receipt) }, manifest: rows };
        const admitted = await runInstallStep(progress, 'admit', () => ports.storage.admit(key, object),
          { timeoutMs: sealBudget.admitMs ?? INSTALL_CACHE_ADMIT_TIMEOUT_MS, signal, log: options.log, now: options.now,
            phase: 'seal', ...sealEvents,
            counts: winner => ({ files: winner?.manifest.length ?? 0, bytes: sizeOf(winner?.manifest ?? []) }) });
        try {
          verify(admitted, identity);
          if (admitted.receipt.treeSha256 !== receipt.treeSha256) invalid();
        } catch (error) { await ports.storage.quarantine(key); throw error; }
        return admitted.receipt;
      }, sealBudget, 'seal');
    },
    /** Reverify the seal and manifest on every read-only materialization, warm hit included, then rehash each file as it
     * is read: the caller holds one file (at most 64 MiB) at a time. Any mismatch quarantines the entry. */
    async *materialize(receipt: CacheReceipt): AsyncGenerator<DependencyFile> {
      const object = await read(receipt.key);
      if (!object) invalid();
      const quarantine = async () => { await ports.storage.quarantine(receipt.key); return invalid(); };
      try {
        verify(object, receipt.identity);
        if (object.receipt.treeSha256 !== receipt.treeSha256) invalid();
      } catch { await quarantine(); }
      // Sealed-unit path (§7.1.2 consumption): one archive GET, digest check, streaming extraction with the
      // bounded reader, tree-digest check over rehashed rows. Any mismatch quarantines as `sealed_unit_invalid`.
      const archive = object.receipt.archive;
      if (archive) {
        try {
          const stored = await ports.storage.getArchive(archive.ref);
          if (!stored || sha256(stored) !== archive.sha256) throw new LiveError('sealed_unit_invalid');
          const rows: DependencyEntry[] = [];
          const archiveFailure: TransferFailure = kind => {
            if (kind === 'limit') throw new LiveError('limit_exceeded');
            throw new LiveError('sealed_unit_invalid');
          };
          for await (const file of extractTarZst(stored, stored.byteLength, TREE_LIMITS, archiveFailure)) {
            rows.push({ path: file.path, mode: file.mode, size: file.bytes.byteLength, sha256: sha256(file.bytes) });
            yield { path: file.path, mode: file.mode, bytes: file.bytes };
          }
          if (treeDigest(rows) !== object.receipt.treeSha256) throw new LiveError('sealed_unit_invalid');
        } catch (error) {
          await ports.storage.quarantine(receipt.key);
          if (error instanceof LiveError && error.code === 'sealed_unit_invalid') throw error;
          throw new LiveError('sealed_unit_invalid');
        }
        return;
      }
      // Transition dual-read (D8): entries sealed before L1 carry no archive pointer — per-file fallback.
      for (const entry of object.manifest) {
        const bytes = await ports.storage.getFile(entry.sha256);
        if (!bytes || bytes.byteLength !== entry.size || sha256(bytes) !== entry.sha256) await quarantine();
        yield { path: entry.path, mode: entry.mode, bytes: bytes! };
      }
    },
    /** Sealed-unit archive bytes for in-pod materialization (§7.1.2 consumption): one S3 GET, digest
     * check, no extraction API-side. Returns `undefined` for pre-L1 entries without an archive pointer
     * (D8 transition dual-read: callers fall back to per-file `materialize`). Any mismatch quarantines
     * as `sealed_unit_invalid`. */
    async sealedArchive(receipt: CacheReceipt): Promise<{ bytes: Uint8Array; treeSha256: string } | undefined> {
      const object = await read(receipt.key);
      if (!object) invalid();
      try {
        verify(object, receipt.identity);
        if (object.receipt.treeSha256 !== receipt.treeSha256) invalid();
      } catch {
        await ports.storage.quarantine(receipt.key);
        return invalid();
      }
      const archive = object.receipt.archive;
      if (!archive) return undefined;
      try {
        const stored = await ports.storage.getArchive(archive.ref);
        if (!stored || sha256(stored) !== archive.sha256) throw new LiveError('sealed_unit_invalid');
        return { bytes: stored, treeSha256: object.receipt.treeSha256 };
      } catch (error) {
        await ports.storage.quarantine(receipt.key);
        if (error instanceof LiveError && error.code === 'sealed_unit_invalid') throw error;
        throw new LiveError('sealed_unit_invalid');
      }
    },
  };
}
/** Byte sum of manifest rows (admit/seal-archive counts). */
function sizeOf(rows: readonly { size: number }[]) {
  return rows.reduce((total, entry) => total + entry.size, 0);
}
