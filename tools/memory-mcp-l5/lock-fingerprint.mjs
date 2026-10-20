// lock-fingerprint.mjs — versioned fingerprint of the resolved P1 dependency + build-tool closure.
//
// Version 2 wires the whole model together: the per-consumer resolved closure
// (lock-closure.mjs) plus the build-input record derived from the build definition
// (build-inputs.mjs). No manually maintained input list exists: changing a real
// dependency resolution or build input changes the digest, and unrelated lockfile
// edits leave it unchanged. The full lockfile sha stays in the manifest source as
// generation provenance alongside its immutable snapshot, and is never compared
// against later checkouts.
import { createHash } from 'node:crypto';
import { canonicalizeJson } from './schema-validator.mjs';
import { buildP1Closure } from './lock-closure.mjs';
import { parseToolchainSpecs, hashConfigFiles, specName } from './build-inputs.mjs';

export const LOCK_FINGERPRINT_VERSION = 2;

export function buildToolNames(toolchain) {
  const names = new Set();
  for (const specs of Object.values((toolchain && toolchain.targets) || {})) {
    for (const spec of specs || []) names.add(specName(spec));
  }
  return names;
}

export function computeLockFingerprint({ lockDoc, makefileText, configFiles }) {
  const toolchain = parseToolchainSpecs(makefileText);
  const closure = buildP1Closure(lockDoc, buildToolNames(toolchain));
  const configs = hashConfigFiles(configFiles || {});
  const canonical = canonicalizeJson({ version: LOCK_FINGERPRINT_VERSION, closure, toolchain, configs });
  return createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
}
