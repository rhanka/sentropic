import { ArtifactOperationError } from './failures.js';
import { buildJson, buildPath, buildRecord } from './build-contract.js';
import type { ArtifactBuildSnapshot, PostinstallAllowlistEntry } from './build-contract.js';
import { dependencyIntegrity, type DependencyIntegrityInventory, type RemoteLockEntry } from './build-integrity.js';

/** A-LIVE §7.3 host qualification row: literal lockfile SRI only; disabled rows never authorize execution. */
export interface ScriptQualificationRecord extends PostinstallAllowlistEntry {
  readonly source: 'lockfile';
  readonly execution: 'disabled' | 'allowlisted';
}
export interface BuildDependencyEvidence {
  readonly postinstall: readonly PostinstallAllowlistEntry[];
  readonly scriptQualification: readonly ScriptQualificationRecord[];
  readonly integrity: DependencyIntegrityInventory;
}

const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
function refuse(): never { throw new ArtifactOperationError('dep_outside_lock'); }
const SEMVER = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;
function registryUrl(value: unknown, registries: readonly string[]): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search
      && registries.some(registry => {
        const base = new URL(registry.endsWith('/') ? registry : `${registry}/`);
        return base.protocol === 'https:' && !base.username && !base.password
          && url.origin === base.origin && url.pathname.startsWith(base.pathname);
      });
  } catch { return false; }
}
function registrySpec(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  const alias = /^npm:(?:@[^/]+\/)?[^@]+@(.+)$/.exec(value);
  return /^[A-Za-z0-9~^*<>=| .+-]+$/.test(alias ? alias[1] : value);
}

/** Validate the lock-indexed install closure, including host-owned lifecycle permissions. */
export function validateBuildDependencies(
  snapshot: ArtifactBuildSnapshot, lock: Record<string, unknown>, installDirectory: string, lockfileDigest: string,
): BuildDependencyEvidence {
  if ((lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) || !buildRecord(lock.packages)
    || !buildRecord(lock.packages[''])) throw new ArtifactOperationError('build_descriptor_invalid');
  const packages = lock.packages;
  const lockedPackage = (path: string, name: string): boolean => {
    let directory = path;
    for (;;) {
      if (Object.hasOwn(packages, `${directory ? `${directory}/` : ''}node_modules/${name}`)) return true;
      if (!directory) return false;
      directory = directory.includes('/') ? directory.slice(0, directory.lastIndexOf('/')) : '';
    }
  };
  const registries = snapshot.allowedRegistries ?? ['https://registry.npmjs.org/'];
  const allowlist = snapshot.postinstallAllowlist ?? [];
  const qualified = snapshot.scriptQualification ?? [];
  const postinstall: PostinstallAllowlistEntry[] = [];
  const scriptQualification: ScriptQualificationRecord[] = [];
  const lockName = (path: string, raw: Record<string, unknown>): unknown =>
    typeof raw.name === 'string' ? raw.name : path.split('node_modules/').at(-1);
  const repositoryPath = (path: string): string => installDirectory ? `${installDirectory}/${path}` : path;
  const workspaceTargets = new Set<string>();
  for (const [path, raw] of Object.entries(packages)) {
    if (!buildRecord(raw) || (path !== '' && !buildPath(path))
      || (raw.hasInstallScript !== undefined && typeof raw.hasInstallScript !== 'boolean')) refuse();
    if (raw.link === true) {
      if (!path.includes('node_modules/') || !buildPath(raw.resolved)
        || raw.resolved.split('/').includes('node_modules') || !buildRecord(packages[raw.resolved])
        || !Object.hasOwn(snapshot.files, repositoryPath(`${raw.resolved}/package.json`))) refuse();
      workspaceTargets.add(raw.resolved);
      const workspace = buildJson(snapshot.files[repositoryPath(`${raw.resolved}/package.json`)]);
      if (path.split('node_modules/').at(-1) !== workspace.name) refuse();
    }
  }
  const remote: RemoteLockEntry[] = [];
  for (const [path, raw] of Object.entries(packages)) {
    if (!buildRecord(raw) || raw.link === true || path === '' || workspaceTargets.has(path)) continue;
    const name = lockName(path, raw);
    if ((raw.resolved !== undefined && !registryUrl(raw.resolved, registries)) || typeof name !== 'string'
      || typeof raw.version !== 'string' || !SEMVER.test(raw.version)) refuse();
    remote.push({ path, name, version: raw.version, resolved: raw.resolved as string | undefined, integrity: raw.integrity });
  }
  // Every remote byte sequence is covered before any dependency or script rule admits the lock.
  const integrity = dependencyIntegrity(remote, lockfileDigest, snapshot.integrityMap,
    value => registryUrl(value, registries));
  const evidence = new Map(integrity.entries.map(entry => [entry.path, entry]));
  for (const [path, raw] of Object.entries(packages)) {
    if (!buildRecord(raw)) refuse();
    if (raw.link === true) continue;
    const local = path === '' || workspaceTargets.has(path);
    const manifestPath = repositoryPath(path ? `${path}/package.json` : 'package.json');
    const manifest = local ? buildJson(snapshot.files[manifestPath]) : raw;
    for (const source of [raw, manifest]) {
      for (const section of sections) {
        const dependencies = source[section];
        if (dependencies === undefined) continue;
        if (!buildRecord(dependencies)) refuse();
        for (const [name, spec] of Object.entries(dependencies)) {
          if (!registrySpec(spec) || !/^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(name)) refuse();
          if ((section === 'dependencies' || (local && section === 'devDependencies'))
            && !lockedPackage(path, name)) refuse();
        }
      }
    }
    // npm ci must not resolve an edited workspace manifest beyond its committed lock entry.
    if (local) {
      for (const section of sections) {
        const declared = manifest[section];
        const locked = raw[section];
        if (declared === undefined && locked === undefined) continue;
        if (!buildRecord(declared) || !buildRecord(locked)
          || Object.keys(declared).length !== Object.keys(locked).length
          || Object.entries(declared).some(([name, spec]) => locked[name] !== spec)) refuse();
      }
    }
    const scripts = buildRecord(manifest.scripts) ? manifest.scripts : {};
    const hasScript = raw.hasInstallScript === true
      || ['preinstall', 'install', 'postinstall', 'prepare'].some(name => Object.hasOwn(scripts, name));
    if (!hasScript) continue;
    // Only a literal lockfile SRI can close the exact G0 triple; a host-map value never qualifies (A-LIVE §7.3).
    const record = evidence.get(path);
    const entry = { package: local ? manifest.name : lockName(path, raw), version: raw.version,
      integrity: record?.source === 'lockfile' ? record.integrity : undefined };
    if (typeof entry.package !== 'string' || typeof entry.version !== 'string' || entry.integrity === undefined) {
      throw new ArtifactOperationError('install_script_not_allowlisted');
    }
    const triple = { package: entry.package, version: entry.version, integrity: entry.integrity };
    const same = (row: PostinstallAllowlistEntry): boolean => row.package === triple.package
      && row.version === triple.version && row.integrity === triple.integrity;
    const execution = allowlist.some(same) ? 'allowlisted' : qualified.some(same) ? 'disabled' : undefined;
    if (execution === undefined) throw new ArtifactOperationError('install_script_not_allowlisted');
    if (execution === 'allowlisted') postinstall.push(triple);
    scriptQualification.push({ ...triple, source: 'lockfile', execution });
  }
  const scriptKey = snapshot.subPath.slice(installDirectory ? installDirectory.length + 1 : 0);
  if (scriptKey && !workspaceTargets.has(scriptKey)) refuse();
  return { postinstall, scriptQualification, integrity };
}
