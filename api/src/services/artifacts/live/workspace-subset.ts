import { LiveError } from './records';

/** One workspace directory relative to the repository root (e.g. `ui`), never the root itself. */
export const MAX_WORKSPACES = 16;
const SEGMENT = /^[A-Za-z0-9._@+-]+$/;

export function isSafeWorkspaceName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value.includes('\\')
    || value.includes('\0') || value.startsWith('/') || value.endsWith('/')) return false;
  return value.split('/').every(p => p !== '' && p !== '.' && p !== '..' && SEGMENT.test(p));
}

/** Shape check of the server-side option (traversal refused here; declared-workspace check is `validateWorkspaces`). */
export function parseInstallWorkspaces(value: unknown): readonly string[] | null {
  if (value === undefined || !Array.isArray(value) || value.length === 0 || value.length > MAX_WORKSPACES) return null;
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isSafeWorkspaceName(entry) || seen.has(entry)) return null;
    seen.add(entry);
  }
  return [...seen];
}

const workspacesField = (manifest: Record<string, unknown>): string[] | null => {
  const field = manifest.workspaces;
  const list = (Array.isArray(field) ? field : recordOf(field)?.packages) as unknown;
  return Array.isArray(list) && list.length > 0 && list.every(p => typeof p === 'string' && p) ? list as string[] : null;
};

const patternToRegExp = (pattern: string): RegExp | null => {
  if (!pattern || pattern.includes('\\') || pattern.includes('\0')) return null;
  const parts = pattern.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) return null;
  const body = parts.map(p => p === '*' ? '[^/]+' : p.includes('*') ? null
    : p.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('/');
  return body.includes('null') ? null : new RegExp(`^${body}$`);
};

/** Declared workspace directories: root `workspaces` globs matched against repo package.json dirs (root excluded). */
export function declaredWorkspaceDirs(rootManifestText: string, packageJsonPaths: readonly string[]): Set<string> {
  let parsed: unknown;
  try { parsed = JSON.parse(rootManifestText); } catch { return new Set(); }
  const manifest = recordOf(parsed);
  if (!manifest) return new Set();
  const patterns = workspacesField(manifest);
  if (!patterns) return new Set();
  const declared = new Set<string>();
  for (const pattern of patterns) {
    const match = patternToRegExp(pattern);
    if (!match) continue;
    for (const path of packageJsonPaths) {
      if (path === 'package.json' || !path.endsWith('/package.json')) continue;
      const dir = path.slice(0, -'/package.json'.length);
      if (match.test(dir)) declared.add(dir);
    }
  }
  return declared;
}

type LockPackages = Record<string, Record<string, unknown>>;
const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;
const REMOTE_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const depsOf = (entry: Record<string, unknown>, sections: readonly string[]): string[] =>
  sections.flatMap(section => Object.keys(recordOf(entry[section]) ?? {}));

/** npm hoisting lookup from `fromDir` up to the root (e.g. `ui` then `` for `@scope/name`). */
function resolveLocked(packages: LockPackages, fromDir: string, name: string): string | null {
  let dir: string | null = fromDir;
  for (;;) {
    const candidate = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
    if (Object.hasOwn(packages, candidate)) return candidate;
    if (!dir) return null;
    dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
  }
}

/** Subset rule (`npm ci --workspace=<ws>` from the root): the selected workspaces, every workspace reachable
 * through their dependency links, and every remote package reachable from those plus the root devDependencies
 * (the build runs from the root). Remote traversal uses runtime sections only. Returns remote lock paths to keep. */
export function subsetLockPaths(lockText: string, selection: readonly string[]): Set<string> {
  let packages: LockPackages;
  try {
    const lock = recordOf(JSON.parse(lockText))?.packages;
    if (!recordOf(lock)?.['']) return new Set();
    packages = lock as LockPackages;
  } catch { return new Set(); }
  const keep = new Set<string>();
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const name of selection) {
    if (Object.hasOwn(packages, name) && !visited.has(name)) { visited.add(name); queue.push(name); }
  }
  const baseOf = (path: string): string =>
    path.includes('/node_modules/') ? path.slice(0, path.lastIndexOf('/node_modules/')) : '';
  const step = (entry: Record<string, unknown>, sections: readonly string[], base: string): void => {
    for (const dep of depsOf(entry, sections)) {
      const found = resolveLocked(packages, base, dep);
      const target = found && !keep.has(found) ? recordOf(packages[found]) : null;
      if (!found || !target) continue;
      if (target.link === true) {
        const resolved = typeof target.resolved === 'string' ? target.resolved : '';
        if (resolved && Object.hasOwn(packages, resolved) && !visited.has(resolved)) { visited.add(resolved); queue.push(resolved); }
      } else { keep.add(found); step(target, REMOTE_SECTIONS, baseOf(found)); }
    }
  };
  while (queue.length) {
    const dir = queue.shift()!;
    const entry = recordOf(packages[dir]);
    if (entry) step(entry, SECTIONS, dir);
  }
  const root = recordOf(packages['']);
  if (root) step(root, ['devDependencies'], '');
  return keep;

}

const invalid = (): never => { throw new LiveError('build_descriptor_invalid', 'unknown_workspace'); };

/** Fail-closed declared-workspace check at snapshot time: every selected directory must be declared. */
export function validateWorkspaces(selection: readonly string[], rootManifestText: string,
  packageJsonPaths: readonly string[]): readonly string[] {
  const declared = declaredWorkspaceDirs(rootManifestText, packageJsonPaths);
  const sorted = [...selection].sort();
  for (const name of sorted) if (!declared.has(name)) invalid();
  return sorted;
}
