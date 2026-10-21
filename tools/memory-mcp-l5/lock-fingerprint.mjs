// lock-fingerprint.mjs — versioned fingerprint of the resolved P1 dependency + build-tool closure.
//
// Version 3 wires the whole model together: the per-consumer resolved closure from the
// workspace root lock (lock-closure.mjs), the authoritative toolchain record — the
// committed union snapshot of the actual fresh installation the producing build consumes
// via `npm ci`, projected with its integrity values and transitive edges — plus the
// build-input record derived from the build definition (build-inputs.mjs), covering the
// install specs, the emitting commands and the effective build image. No manually
// maintained input list exists: changing a real dependency resolution or build input
// changes the digest, and unrelated lockfile edits leave it unchanged. The full lockfile
// sha stays in the manifest source as generation provenance alongside its immutable
// snapshot, and is never compared against later checkouts.
import { createHash } from 'node:crypto';
import { canonicalizeJson } from './schema-validator.mjs';
import { buildP1Closure, buildToolchainClosure } from './lock-closure.mjs';
import { parseToolchainSpecs, hashConfigFiles, specName, assertToolchainSnapshot } from './build-inputs.mjs';

export const LOCK_FINGERPRINT_VERSION = 3;

export function buildToolNames(toolchain) {
  const names = new Set();
  for (const specs of Object.values((toolchain && toolchain.targets) || {})) {
    for (const spec of specs || []) names.add(specName(spec));
  }
  return names;
}

function snapshotPackageProjection(snapshotPkg) {
  const pkg = snapshotPkg && typeof snapshotPkg === 'object' ? snapshotPkg : {};
  const deps = pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {};
  return {
    name: typeof pkg.name === 'string' ? pkg.name : null,
    version: typeof pkg.version === 'string' ? pkg.version : null,
    dependencies: { ...deps },
  };
}

export function computeLockFingerprint({ lockDoc, makefileText, configFiles, toolchainLocks }) {
  const toolchain = parseToolchainSpecs(makefileText);
  const snapshotLock = toolchainLocks && toolchainLocks.lock;
  const snapshotPkg = toolchainLocks && toolchainLocks.pkg;
  if (!snapshotLock || typeof snapshotLock !== 'object' || !snapshotPkg || typeof snapshotPkg !== 'object') {
    throw new Error('build inputs: toolchain snapshot lock and package are required; regenerate via memory-l5-toolchain-snapshot');
  }
  assertToolchainSnapshot(toolchain, snapshotPkg);
  const closure = buildP1Closure(lockDoc, buildToolNames(toolchain));
  const toolchainClosure = buildToolchainClosure(snapshotLock);
  const snapshotPkgProjection = snapshotPackageProjection(snapshotPkg);
  const configs = hashConfigFiles(configFiles || {});
  const canonical = canonicalizeJson({ version: LOCK_FINGERPRINT_VERSION, closure, toolchain, toolchainClosure, snapshotPkg: snapshotPkgProjection, configs });
  return createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
}
