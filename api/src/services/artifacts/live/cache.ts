import { createHmac, timingSafeEqual } from 'node:crypto';
import { safeDependencyPath, sha256, verifySri, type IntegrityPin } from './integrity';
import { integrityEvidence, qualifyBuild, type Gb1Source } from './gb1-qualification';
import { LiveError, type LiveRuntime } from './records';
import { BUILDER_IMAGE, INSTALL_RECIPE, NPM_RELAY } from './recipes';
import { TREE_LIMITS } from './supervisor-transfer';

export interface CacheIdentity {
  storageScopeId: string; repoId: string; lockSha256: string; platform: string;
  nodeVersion: string; npmVersion: string; image: string; policyRevision: string;
  workspaceTopology: string; integrityDigest: string;
}
/** One regular dependency file of a sealed manifest; its bytes are one private object addressed by their sha256. */
export interface DependencyEntry { path: string; mode: 292 | 365; size: number; sha256: string }
export interface DependencyFile { path: string; mode: 292 | 365; bytes: Uint8Array }
export interface CacheReceipt {
  key: string; identity: CacheIdentity; treeSha256: string; inventory: readonly IntegrityPin[];
  runId: string; installOptions: typeof INSTALL_RECIPE; seal: string;
}
export interface CacheObject { receipt: CacheReceipt; manifest: readonly DependencyEntry[] }
export interface CachePorts {
  signingKey(): Uint8Array;
  /** Downloads exact pinned tarballs through this relay; redirects/alternate registries are forbidden. */
  fetch(pin: IntegrityPin, relay: typeof NPM_RELAY): Promise<Uint8Array>;
  /** Fresh empty install directory, fixed npm config, verified tarballs read one at a time, no branch .npmrc or hooks.
   * Each installed regular file goes to `sink` as soon as it is read, so neither side holds the whole tree. */
  cleanInstall(input: { lockfile: Uint8Array; identity: CacheIdentity; recipe: typeof INSTALL_RECIPE;
    stagingRef: string; runtime?: LiveRuntime; tarballs: AsyncIterable<{ pin: IntegrityPin; bytes: Uint8Array }>;
    sink(file: DependencyFile): Promise<void> }): Promise<{ runId: string }>;
  storage: {
    read(key: string): Promise<CacheObject | undefined>;
    /** Atomic immutable create: partial entries are invisible; returns the winning complete object. */
    admit(key: string, object: CacheObject): Promise<CacheObject>;
    quarantine(key: string): Promise<void>;
    /** Content-addressed file objects shared by every entry; `getFile` returns stored bytes that the cache rehashes. */
    putFile(sha256: string, bytes: Uint8Array): Promise<void>;
    getFile(sha256: string): Promise<Uint8Array | undefined>;
  };
}
function invalid(): never { throw new LiveError('dependency_cache_invalid'); }
const cacheKey = (id: CacheIdentity) => `${id.lockSha256}/${sha256(JSON.stringify([
  id.storageScopeId, id.repoId, id.platform, id.nodeVersion, id.npmVersion, id.image,
  id.policyRevision, id.workspaceTopology, id.integrityDigest,
]))}`;
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
export function createDependencyCache(ports: CachePorts) {
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
    async acquire(source: { lockfile: Uint8Array; cacheIdentity: CacheIdentity; stagingRef: string; gb1: Gb1Source },
      runtime?: LiveRuntime) {
      const identity = source.cacheIdentity;
      if (identity.image !== BUILDER_IMAGE || sha256(source.lockfile) !== identity.lockSha256) invalid();
      // GB1 at the pinned commit (W5 port); the qualification file digest is the identity's integrity digest.
      const evidence = integrityEvidence(qualifyBuild(source.gb1));
      if (evidence.lockSha256 !== identity.lockSha256 || evidence.digest !== identity.integrityDigest) invalid();
      const { inventory } = evidence;
      const key = cacheKey(identity);
      const existing = await read(key);
      if (existing) {
        try { return verify(existing, identity); }
        catch (error) { await ports.storage.quarantine(key); throw error; }
      }
      /** One verified tarball at a time; an altered one stops the stream before the pod runs the install. */
      async function* tarballs() {
        for (const pin of inventory) {
          const bytes = await ports.fetch(pin, NPM_RELAY);
          verifySri(bytes, pin.integrity);
          yield { pin, bytes };
        }
      }
      const manifest: DependencyEntry[] = [];
      const sink = async (file: DependencyFile) => {
        if (manifest.length >= TREE_LIMITS.files || !(file.bytes instanceof Uint8Array)) invalid();
        const digest = sha256(file.bytes);
        await ports.storage.putFile(digest, file.bytes);
        manifest.push({ path: file.path, mode: file.mode, size: file.bytes.byteLength, sha256: digest });
      };
      const installed = await ports.cleanInstall({ ...source, identity, runtime, recipe: INSTALL_RECIPE, tarballs: tarballs(), sink });
      if (!installed.runId) invalid();
      const receipt = { key, identity, treeSha256: treeDigest(manifest), inventory,
        runId: installed.runId, installOptions: INSTALL_RECIPE };
      const object = { receipt: { ...receipt, seal: seal(receipt) }, manifest };
      const admitted = await ports.storage.admit(key, object);
      try {
        verify(admitted, identity);
        if (admitted.receipt.treeSha256 !== receipt.treeSha256) invalid();
      } catch (error) { await ports.storage.quarantine(key); throw error; }
      return admitted.receipt;
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
      for (const entry of object.manifest) {
        const bytes = await ports.storage.getFile(entry.sha256);
        if (!bytes || bytes.byteLength !== entry.size || sha256(bytes) !== entry.sha256) await quarantine();
        yield { path: entry.path, mode: entry.mode, bytes: bytes! };
      }
    },
  };
}
