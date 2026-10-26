// Receiving validation only: a valid manifest never substitutes for installed/crash proofs.
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex, sha512Integrity, PINNED_IMAGE_DIGEST } from './schema-validator.mjs';
import { readArchive } from './contract-graph.mjs';
import { checkNodeFloor, checkArtifactManifest } from './receipt.mjs';
import { readInside } from './precandidate.mjs';
import { resolveLockKey } from './lock-closure.mjs';
export const P3_SHA256 = '1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730';
export const E2_SHA256 = 'eaf9a3d520aa9d35b261b406313745b4076299b9087eafc1ce076c49e0a34cc1';
const ROOT_KEYS = ['manifestVersion', 'stage', 'status', 'preCandidate', 'e2', 'backend', 'neutralDeclarations', 'hostProfile', 'lock', 'closure', 'runtime', 'acknowledgements'];
const REF_KEYS = ['path', 'sha256'];
export function validateLot2Provenance(m, root) {
  const errors = [];
  const closed = (value, keys, label) => {
    if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).sort().join() !== [...keys].sort().join()) {
      errors.push(`${label}: closed fields required`); return false;
    }
    return true;
  };
  if (!closed(m, ROOT_KEYS, 'manifest')) return errors;
  if (m.manifestVersion !== 1 || m.stage !== 'lot2') errors.push('manifest: version/stage');
  if (m.status !== 'verified') errors.push('manifest: unverified');
  const read = (ref, label, archive = false) => {
    if (!closed(ref, archive ? [...REF_KEYS, 'name', 'version', 'integrity'] : REF_KEYS, label)) return null;
    try {
      if (typeof ref.path !== 'string' || !ref.path || ref.path.startsWith('/') || ref.path.split('/').includes('..') || !/^[0-9a-f]{64}$/.test(ref.sha256)) throw Error();
      const file = realpathSync(resolve(root, ref.path)), rel = relative(realpathSync(root), file);
      if (rel.startsWith('..') || rel.startsWith('/')) throw Error();
      const bytes = readFileSync(file);
      if (sha256Hex(bytes) !== ref.sha256) { errors.push(`${label}: sha256 mismatch`); return null; }
      if (archive && sha512Integrity(bytes) !== ref.integrity) { errors.push(`${label}: integrity mismatch`); return null; }
      return bytes;
    } catch { errors.push(`${label}: missing/unsafe input`); return null; }
  };
  const json = (ref, label) => {
    const bytes = read(ref, label);
    try { return bytes ? JSON.parse(bytes) : null; } catch { errors.push(`${label}: invalid JSON`); return null; }
  };
  const pre = json(m.preCandidate, 'preCandidate');
  if (m.preCandidate?.sha256 !== P3_SHA256 || pre?.stage !== 'pre-candidate') errors.push('preCandidate: exact frozen P3 required');
  if (m.e2?.name !== '@sentropic/engram' || m.e2?.version !== '0.21.2') errors.push('e2: exact published substrate 0.21.2 required');
  if (m.e2?.sha256 !== E2_SHA256) errors.push('e2: published substrate digest mismatch');
  if (m.backend?.name !== '@sentropic/cluster-mesh') errors.push('backend: public cluster-mesh required');
  const packages = new Map();
  for (const [index, entry] of (Array.isArray(m.closure) ? m.closure : []).entries()) {
    const bytes = read(entry, `closure[${index}]`, true);
    if (!bytes) continue;
    const id = `${entry.name}@${entry.version}`;
    if (packages.has(id)) errors.push(`closure: duplicate ${id}`);
    try {
      const files = readArchive(bytes), pkg = JSON.parse(files.get('package.json'));
      if (pkg.name !== entry.name || pkg.version !== entry.version) errors.push(`closure: package identity ${entry.name}`);
      packages.set(id, { entry, pkg, files });
    } catch { errors.push(`closure: invalid archive ${entry.name}`); }
  }
  for (const label of ['e2', 'backend']) {
    read(m[label], label, true);
    const found = packages.get(`${m[label]?.name}@${m[label]?.version}`);
    if (!found || ['path', 'sha256', 'name', 'version', 'integrity'].some(k => found.entry[k] !== m[label][k])) errors.push(`${label}: absent/mismatched closure`);
  }
  const lock = json(m.lock, 'lock');
  if (lock?.lockfileVersion !== 3 || !lock?.packages || !Array.isArray(m.closure) || !m.closure.length) errors.push('closure: complete v3 installed lock required');
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (!key) continue;
    const name = key.split('node_modules/').pop(), found = packages.get(`${name}@${entry.version}`);
    if (entry.link || !found || entry.version !== found.entry.version || entry.integrity !== found.entry.integrity ||
        typeof entry.resolved !== 'string' || !entry.resolved.startsWith('https://registry.npmjs.org/')) errors.push(`lock: unbound package ${key}`);
    for (const dependency of Object.keys(found?.pkg.dependencies ?? {})) {
      if (!resolveLockKey(lock.packages, key, dependency)) errors.push(`lock: missing transitive ${key}/${dependency}`);
    }
  }
  for (const { entry } of packages.values()) {
    if (!Object.entries(lock?.packages ?? {}).some(([key, node]) => key.endsWith(`node_modules/${entry.name}`) && node.version === entry.version)) errors.push(`lock: missing ${entry.name}@${entry.version}`);
  }
  for (const label of ['e2', 'backend']) {
    const pkg = m[label];
    if (lock?.packages?.['']?.dependencies?.[pkg?.name] !== pkg?.version) errors.push(`lock: exact root ${label} pin required`);
  }
  const substrate = packages.get('@sentropic/engram@0.21.2');
  const entry = substrate?.pkg.exports?.['./memory-substrate'];
  const importEntry = entry?.import?.default ?? entry?.import;
  if (typeof importEntry !== 'string' || !substrate.files.has(importEntry.replace(/^\.\//, ''))) errors.push('e2: installed public memory-substrate export required');
  const neutral = json(m.neutralDeclarations, 'neutralDeclarations'), profile = json(m.hostProfile, 'hostProfile');
  for (const [label, doc] of [['neutralDeclarations', neutral], ['hostProfile', profile]]) {
    if (doc?.status !== 'verified' || doc?.preCandidateManifestSha256 !== P3_SHA256 || doc?.e2Sha256 !== m.e2?.sha256 || doc?.backendSha256 !== m.backend?.sha256) errors.push(`${label}: tuple not verified`);
  }
  if (profile?.backend !== 'postgresql' || !['16', '17'].includes(String(profile?.databaseMajor)) || !profile?.configurationSha256 || !profile?.driverBridgeSha256) errors.push('hostProfile: actual PG/driver/configuration required');
  if (!closed(m.runtime, ['imageDigest', 'nodeVersion', 'sqliteVersion', 'python', 'nativeAddonCompilation'], 'runtime') ||
      m.runtime.imageDigest !== PINNED_IMAGE_DIGEST || !/^24\./.test(m.runtime.nodeVersion) || !checkNodeFloor(m.runtime.nodeVersion, [], '') ||
      !/^\d+\.\d+\.\d+$/.test(m.runtime.sqliteVersion) || m.runtime.python !== false || m.runtime.nativeAddonCompilation !== false) errors.push('runtime: pinned zero-Python/no-addon runtime required');
  if (closed(m.acknowledgements, ['g1', 'g2', 'g3', 'g4', 'c9'], 'acknowledgements')) {
    for (const [name, ref] of Object.entries(m.acknowledgements)) {
      const receipt = json(ref, `acknowledgements.${name}`);
      if (receipt?.status !== 'accepted' || receipt?.preCandidateManifestSha256 !== P3_SHA256 || receipt?.e2Sha256 !== m.e2?.sha256 || receipt?.backendSha256 !== m.backend?.sha256) errors.push(`acknowledgements.${name}: actual tuple disposition required`);
    }
  }
  return errors;
}
/** The outer envelope is the existing frozen schema; host details are digest-bound provenance. */
export function validateLot2Manifest(m, root) {
  const errors = checkArtifactManifest(m);
  if (errors.length) return errors;
  if (m.stage !== 'lot2' || m.preCandidateManifestSha256 !== P3_SHA256 || m.e2ArtifactSha256 !== E2_SHA256) return ['manifest: exact P3/E2 lot2 envelope required'];
  const read = ref => {
    const file = realpathSync(resolve(root, ref.path)), rel = relative(realpathSync(root), file);
    if (rel.startsWith('..') || rel.startsWith('/')) throw Error('manifest: unsafe reference');
    const bytes = readFileSync(file);
    if (sha256Hex(bytes) !== ref.sha256) throw Error('manifest: reference sha256 mismatch');
    return bytes;
  };
  try {
    const provenance = JSON.parse(read(m.e2Provenance));
    errors.push(...validateLot2Provenance(provenance, root));
    const preBytes = readInside(root, 'tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json');
    if (sha256Hex(preBytes) !== P3_SHA256) throw Error('manifest: retained P3 changed');
    const pre = JSON.parse(preBytes);
    errors.push(...checkArtifactManifest(m, { retainedContractInventory: pre.contractInventory }));
    if (m.source.specSha256 !== pre.source.specSha256 || m.source.l0Commit !== pre.source.l0Commit) errors.push('manifest: frozen spec/L0 mismatch');
    const snapshot = read(m.source.declaredLockSnapshot);
    if (sha256Hex(snapshot) !== m.source.declaredLockSha256) errors.push('manifest: declared lock mismatch');
    for (const ref of m.source.toolchainSnapshots) read(ref);
    for (const artifact of m.artifacts) {
      const bytes = read({ path: artifact.archive, sha256: artifact.sha256 });
      if (sha512Integrity(bytes) !== artifact.integrity) errors.push(`manifest: archive integrity ${artifact.name}`);
      const item = provenance.closure?.find(x => x.name === artifact.name && x.version === artifact.version);
      if (!item || item.sha256 !== artifact.sha256 || item.integrity !== artifact.integrity || item.path !== artifact.archive) errors.push(`manifest: unbound artifact ${artifact.name}`);
    }
    if (!m.artifacts.some(a => a.role === 'broker' && a.name === '@sentropic/mcp-broker') ||
        !m.artifacts.some(a => a.role === 'mesh' && a.name === '@sentropic/cluster-mesh')) errors.push('manifest: broker reference and host backend artifacts required');
  } catch (error) { errors.push(error.message); }
  return errors;
}
export function receiveLot2Manifest(path, root) {
  const bytes = readFileSync(resolve(root, path));
  if (readFileSync(resolve(root, path + '.sha256'), 'utf8').trim().split(/\s/)[0] !== sha256Hex(bytes)) throw Error('manifest: sidecar sha256 mismatch');
  const manifest = JSON.parse(bytes), failures = validateLot2Manifest(manifest, root);
  if (failures.length) throw Error(failures.join('\n'));
  return { manifest, manifestSha256: sha256Hex(bytes) };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(receiveLot2Manifest(process.argv[2], process.cwd()))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
