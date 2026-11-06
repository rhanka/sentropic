import { createHmac, timingSafeEqual } from 'node:crypto';
import { integrityInventory, safeDependencyPath, sha256, verifySri, type IntegrityEvidence, type IntegrityPin } from './integrity';
import { LiveError, type LiveRuntime } from './records';
import { BUILDER_IMAGE, INSTALL_RECIPE, NPM_RELAY } from './recipes';

export interface CacheIdentity {
  storageScopeId: string; repoId: string; lockSha256: string; platform: string;
  nodeVersion: string; npmVersion: string; image: string; policyRevision: string;
  workspaceTopology: string; integrityDigest: string;
}
export interface DependencyFile { path: string; type: 'file'; mode: 292 | 365; bytes: string }
export interface CacheReceipt {
  key: string; identity: CacheIdentity; treeSha256: string; inventory: readonly IntegrityPin[];
  runId: string; installOptions: typeof INSTALL_RECIPE; seal: string;
}
export interface CacheObject { receipt: CacheReceipt; files: readonly DependencyFile[] }
export interface CachePorts {
  signingKey(): Uint8Array;
  evidence(lockSha256: string): Promise<IntegrityEvidence>;
  /** Downloads exact pinned tarballs through this relay; redirects/alternate registries are forbidden. */
  fetch(pin: IntegrityPin, relay: typeof NPM_RELAY): Promise<Uint8Array>;
  /** Fresh empty install directory, fixed npm config, verified tarballs, no branch .npmrc or hooks. */
  cleanInstall(input: { lockfile: Uint8Array; identity: CacheIdentity; recipe: typeof INSTALL_RECIPE;
    stagingRef: string; runtime?: LiveRuntime; tarballs: readonly { pin: IntegrityPin; bytes: Uint8Array }[] }): Promise<{ files: DependencyFile[]; runId: string }>;
  storage: {
    read(key: string): Promise<CacheObject | undefined>;
    /** Atomic immutable create: partial entries are invisible; returns the winning complete object. */
    admit(key: string, object: CacheObject): Promise<CacheObject>;
    quarantine(key: string): Promise<void>;
  };
}
function invalid(): never { throw new LiveError('dependency_cache_invalid'); }
const cacheKey = (id: CacheIdentity) => `${id.lockSha256}/${sha256(JSON.stringify([
  id.storageScopeId, id.repoId, id.platform, id.nodeVersion, id.npmVersion, id.image,
  id.policyRevision, id.workspaceTopology, id.integrityDigest,
]))}`;
function treeDigest(files: readonly DependencyFile[]) {
  if (!Array.isArray(files) || files.length > 65_536) invalid();
  let total = 0;
  const paths = new Set<string>();
  const manifest = files.map(file => {
    if (file.type !== 'file' || !safeDependencyPath(file.path) || paths.has(file.path)
      || ![292, 365].includes(file.mode) || typeof file.bytes !== 'string') invalid();
    paths.add(file.path);
    const bytes = Buffer.from(file.bytes, 'base64');
    total += bytes.length;
    if (bytes.toString('base64') !== file.bytes || bytes.length > 16 * 1024 * 1024 || total > 512 * 1024 * 1024) invalid();
    return [file.path, file.mode, sha256(bytes)];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  for (const path of paths) {
    const parts = path.split('/'); parts.pop();
    while (parts.length) { if (paths.has(parts.join('/'))) invalid(); parts.pop(); }
  }
  return sha256(JSON.stringify(manifest));
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
    const { seal: signature, ...receipt } = object.receipt;
    const expected = Buffer.from(seal(receipt));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)
      || receipt.key !== cacheKey(identity) || cacheKey(receipt.identity) !== cacheKey(identity)
      || treeDigest(object.files) !== receipt.treeSha256) invalid();
    return object.receipt;
  }
  return {
    async acquire(source: { lockfile: Uint8Array; cacheIdentity: CacheIdentity; stagingRef: string }, runtime?: LiveRuntime) {
      const identity = source.cacheIdentity;
      if (identity.image !== BUILDER_IMAGE || sha256(source.lockfile) !== identity.lockSha256) invalid();
      const evidence = await ports.evidence(identity.lockSha256);
      if (evidence.digest !== identity.integrityDigest) invalid();
      const inventory = integrityInventory(source.lockfile, evidence);
      const key = cacheKey(identity);
      const existing = await read(key);
      if (existing) {
        try { return verify(existing, identity); }
        catch (error) { await ports.storage.quarantine(key); throw error; }
      }
      const tarballs = [];
      for (const pin of inventory) {
        const bytes = await ports.fetch(pin, NPM_RELAY);
        verifySri(bytes, pin.integrity);
        tarballs.push({ pin, bytes });
      }
      const installed = await ports.cleanInstall({ ...source, identity, runtime, recipe: INSTALL_RECIPE, tarballs });
      if (!installed.runId) invalid();
      const receipt = { key, identity, treeSha256: treeDigest(installed.files), inventory,
        runId: installed.runId, installOptions: INSTALL_RECIPE };
      const object = { receipt: { ...receipt, seal: seal(receipt) }, files: installed.files };
      const admitted = await ports.storage.admit(key, object);
      try {
        verify(admitted, identity);
        if (admitted.receipt.treeSha256 !== receipt.treeSha256) invalid();
      } catch (error) { await ports.storage.quarantine(key); throw error; }
      return admitted.receipt;
    },
    /** Reverify content on every read-only dependency materialization, including a warm hit. */
    async materialize(receipt: CacheReceipt) {
      const object = await read(receipt.key);
      if (!object) invalid();
      try {
        verify(object, receipt.identity);
        if (object.receipt.treeSha256 !== receipt.treeSha256) invalid();
        return object.files;
      } catch (error) { await ports.storage.quarantine(receipt.key); throw error; }
    },
  };
}
