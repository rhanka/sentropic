import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Metadata-only package resolution following Node's node_modules lookup and the
 * ESM `exports` conditions (`node`, `import`, `default`). Nothing is evaluated.
 */
export interface InstalledPackage {
  readonly name: string;
  /** Physical (realpath) package directory. */
  readonly dir: string;
  readonly version: unknown;
  readonly manifest: Readonly<Record<string, unknown>> | undefined;
}

const CONDITIONS = new Set(['node', 'import', 'default']);

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readManifest(dir: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Directory of the calling module file, resolved to its physical location. A non-file URL
 * (bundler-inlined or non-Node host) falls back to the URL string: lookups then find nothing
 * instead of throwing at module evaluation.
 */
export function physicalDirOf(moduleUrl: string): string {
  let dir: string;
  try {
    dir = dirname(fileURLToPath(moduleUrl));
  } catch {
    return moduleUrl;
  }
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

export function findInstalledPackage(name: string, fromDir: string): InstalledPackage | undefined {
  if (!isAbsolute(fromDir)) return undefined;
  let dir = fromDir;
  for (;;) {
    if (basename(dir) !== 'node_modules') {
      const candidate = join(dir, 'node_modules', ...name.split('/'));
      if (isDirectory(candidate)) {
        let physical = candidate;
        try {
          physical = realpathSync(candidate);
        } catch {
          // keep the logical path; version evidence below decides compatibility
        }
        const manifest = readManifest(physical);
        return { name, dir: physical, version: manifest?.version, manifest };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Nearest enclosing package directory whose manifest has the given name. */
export function findOwningPackageDir(fromDir: string, name: string): string | undefined {
  if (!isAbsolute(fromDir)) return undefined;
  let dir = fromDir;
  for (;;) {
    if (readManifest(dir)?.name === name) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function resolveTarget(target: unknown): string | undefined {
  if (typeof target === 'string') return target.startsWith('./') ? target : undefined;
  if (Array.isArray(target)) {
    for (const entry of target) {
      const resolved = resolveTarget(entry);
      if (resolved) return resolved;
    }
    return undefined;
  }
  if (typeof target === 'object' && target !== null) {
    for (const [key, value] of Object.entries(target)) {
      if (!CONDITIONS.has(key)) continue;
      const resolved = resolveTarget(value);
      if (resolved) return resolved;
    }
  }
  return undefined;
}

function exportTarget(manifest: Readonly<Record<string, unknown>>, subpath: string): string | undefined {
  const exportsField = manifest.exports;
  if (exportsField === undefined) {
    if (subpath !== '.') return undefined;
    return typeof manifest.main === 'string' ? `./${manifest.main.replace(/^\.\//u, '')}` : './index.js';
  }
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) {
    return subpath === '.' ? resolveTarget(exportsField) : undefined;
  }
  if (typeof exportsField !== 'object' || exportsField === null) return undefined;
  const keys = Object.keys(exportsField);
  const isSubpathMap = keys.length > 0 && keys.every((key) => key.startsWith('.'));
  if (!isSubpathMap) return subpath === '.' ? resolveTarget(exportsField) : undefined;
  return resolveTarget((exportsField as Record<string, unknown>)[subpath]);
}

/** Physical file for an exported subpath, or undefined when not exported or missing. */
export function resolveExportFile(pkg: InstalledPackage, subpath: string): string | undefined {
  if (!pkg.manifest) return undefined;
  const target = exportTarget(pkg.manifest, subpath);
  if (!target || target.split('/').includes('..')) return undefined;
  const file = join(pkg.dir, ...target.slice(2).split('/'));
  if (!file.startsWith(pkg.dir + sep)) return undefined;
  try {
    return realpathSync(file);
  } catch {
    return undefined;
  }
}
