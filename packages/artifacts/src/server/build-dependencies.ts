import { ArtifactOperationError } from './failures.js';
import { buildJson, buildPath, buildRecord } from './build-contract.js';
import type { ArtifactBuildSnapshot, PostinstallAllowlistEntry } from './build-contract.js';

const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const refuse = (): never => { throw new ArtifactOperationError('dep_outside_lock'); };
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
  snapshot: ArtifactBuildSnapshot, lock: Record<string, unknown>, installDirectory: string,
): readonly PostinstallAllowlistEntry[] {
  if ((lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) || !buildRecord(lock.packages)
    || !buildRecord(lock.packages[''])) throw new ArtifactOperationError('build_descriptor_invalid');
  const packages = lock.packages;
  const registries = snapshot.allowedRegistries ?? ['https://registry.npmjs.org/'];
  const allowlist = snapshot.postinstallAllowlist ?? [];
  const postinstall: PostinstallAllowlistEntry[] = [];
  const repositoryPath = (path: string): string => installDirectory ? `${installDirectory}/${path}` : path;
  const workspaceTargets = new Set<string>();
  for (const [path, raw] of Object.entries(packages)) {
    if (!buildRecord(raw) || (path !== '' && !buildPath(path))) refuse();
    if (raw.link === true) {
      if (!path.includes('node_modules/') || !buildPath(raw.resolved)
        || raw.resolved.split('/').includes('node_modules') || !buildRecord(packages[raw.resolved])
        || !Object.hasOwn(snapshot.files, repositoryPath(`${raw.resolved}/package.json`))) refuse();
      workspaceTargets.add(raw.resolved);
    }
  }
  for (const [path, raw] of Object.entries(packages)) {
    if (!buildRecord(raw)) refuse();
    if (raw.link === true) continue;
    const local = path === '' || workspaceTargets.has(path);
    if (!local && (!registryUrl(raw.resolved, registries) || typeof raw.version !== 'string'
      || typeof raw.integrity !== 'string' || !raw.integrity)) refuse();
    const manifestPath = repositoryPath(path ? `${path}/package.json` : 'package.json');
    const manifest = local ? buildJson(snapshot.files[manifestPath]) : raw;
    for (const source of [raw, manifest]) {
      for (const section of sections) {
        if (source[section] === undefined) continue;
        if (!buildRecord(source[section])) refuse();
        for (const spec of Object.values(source[section])) if (!registrySpec(spec)) refuse();
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
    const name = typeof raw.name === 'string' ? raw.name : path.split('node_modules/').at(-1);
    const entry = { package: local ? manifest.name : name, version: raw.version, integrity: raw.integrity };
    if (typeof entry.package !== 'string' || typeof entry.version !== 'string' || typeof entry.integrity !== 'string'
      || !entry.integrity || !allowlist.some(allowed => allowed.package === entry.package
        && allowed.version === entry.version && allowed.integrity === entry.integrity)) {
      throw new ArtifactOperationError('install_script_not_allowlisted');
    }
    postinstall.push({ package: entry.package, version: entry.version, integrity: entry.integrity });
  }
  const scriptKey = snapshot.subPath.slice(installDirectory ? installDirectory.length + 1 : 0);
  if (scriptKey && !workspaceTargets.has(scriptKey)) refuse();
  return postinstall;
}
