import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { digest } from '../daily/toolchain-contract.mjs';
import { canonicalize } from '../daily/canonical-json.mjs';
import { requireContract as check, hash, path as pathRule, text } from './contract-schema.mjs';

const execFileAsync = promisify(execFile);
const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json';
const OCI_CONFIG = 'application/vnd.oci.image.config.v1+json';
const OCI_LAYER = 'application/vnd.oci.image.layer.v1.tar';
const OCI_INDEX = 'application/vnd.oci.image.index.v1+json';

// Normalized filesystem identity of a produced rootfs: sorted relative paths with
// per-file digest, size and mode. Symlinks and special files are refused.
export async function normalizeOutputTree(root) {
  check(typeof root === 'string' && root.length > 0, 'output root');
  check(await realpath(root) === resolve(root), 'output root symlink');
  const files = [];
  async function walk(dir, prefix) {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const rel = prefix + entry.name;
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) check(false, `output symlink: ${rel}`);
      if (entry.isDirectory()) await walk(full, `${rel}/`);
      else {
        check(entry.isFile(), `output special file: ${rel}`);
        const stat = await lstat(full);
        const bytes = await readFile(full);
        files.push({ path: rel, digest: digest(bytes), size: bytes.length,
          mode: (stat.mode & 0o777).toString(8).padStart(3, '0') });
      }
    }
  }
  await walk(root, '');
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  check(files.length > 0, 'empty output tree');
  return { filesystemDigest: digest(Buffer.from(canonicalize({ files }))), files };
}

export function parseApkPackage(materialPath) {
  check(pathRule(materialPath), 'os package path');
  const base = materialPath.split('/').pop();
  const match = base.match(/^(.+)-(\d[0-9A-Za-z.+_-]*)\.apk$/);
  check(match, `os package name: ${base}`);
  return { name: match[1], version: match[2] };
}

// `go list -m all` prints the main module without a version on the first line only.
export function parseGoModuleList(stdout) {
  check(typeof stdout === 'string' && stdout.trim().length > 0, 'go module list');
  const modules = [];
  stdout.trim().split('\n').forEach((line, index) => {
    check(!line.includes('=>'), 'module replacement');
    const parts = line.trim().split(/\s+/);
    if (index === 0 && parts.length === 1) modules.push({ name: parts[0], version: '(main)' });
    else {
      check(parts.length === 2 && /^v\d/.test(parts[1]), `go module line: ${line}`);
      modules.push({ name: parts[0], version: parts[1] });
    }
  });
  return modules;
}

// Normalized build/runtime/embedded dependency inventory: resolved Go modules plus
// the pinned OS packages, sorted and deduplicated, digested canonically.
export function dependenciesInventory({ modules, osPackages } = {}) {
  check(Array.isArray(modules) && modules.length > 0 && Array.isArray(osPackages), 'dependency inputs');
  const components = [
    ...modules.map(m => { check(text(m?.name) && text(m?.version), 'go module identity');
      return { type: 'go-module', name: m.name, version: m.version }; }),
    ...osPackages.map(p => { check(text(p?.name) && text(p?.version), 'os package identity');
      return { type: 'os-package', name: p.name, version: p.version }; }),
  ];
  components.sort((a, b) => (`${a.type}/${a.name}/${a.version}` < `${b.type}/${b.name}/${b.version}` ? -1 : 1));
  const keys = components.map(c => `${c.type}/${c.name}/${c.version}`);
  check(new Set(keys).size === keys.length, 'duplicate dependency component');
  return { components, dependenciesDigest: digest(Buffer.from(canonicalize({ components }))) };
}

// Deterministic OCI layout: fixed mtime/owner tar layer, config with the layer
// diff_id, manifest and single linux/amd64 index entry.
export async function makeOciLayout({ rootfs, outDir, labels = {} } = {}) {
  check(typeof rootfs === 'string' && typeof outDir === 'string', 'layout paths');
  for (const [key, value] of Object.entries(labels)) check(text(key) && text(value), 'image label');
  await mkdir(outDir, { recursive: true });
  const layerPath = join(outDir, 'layer.tar');
  await execFileAsync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
    '-cf', layerPath, '-C', rootfs, '.'], { maxBuffer: 64 * 1024 * 1024 });
  const files = {};
  const descriptor = async name => {
    const bytes = await readFile(join(outDir, name));
    files[name] = bytes;
    return { path: name, digest: digest(bytes), size: bytes.length };
  };
  const layer = await descriptor('layer.tar');
  const config = { architecture: 'amd64', os: 'linux', created: '1970-01-01T00:00:00Z',
    rootfs: { type: 'layers', diff_ids: [layer.digest] }, config: { Labels: labels } };
  await writeFile(join(outDir, 'config.json'), JSON.stringify(config));
  const configDesc = await descriptor('config.json');
  const manifest = { schemaVersion: 2, mediaType: OCI_MANIFEST,
    config: { ...configDesc, mediaType: OCI_CONFIG }, layers: [{ ...layer, mediaType: OCI_LAYER }] };
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest));
  const manifestDesc = await descriptor('manifest.json');
  const index = { schemaVersion: 2, mediaType: OCI_INDEX,
    manifests: [{ ...manifestDesc, mediaType: OCI_MANIFEST, platform: { architecture: 'amd64', os: 'linux' } }] };
  await writeFile(join(outDir, 'index.json'), JSON.stringify(index));
  const indexDesc = await descriptor('index.json');
  return { chain: { index: indexDesc, manifest: manifestDesc, config: configDesc, layer, layers: [layer] }, files };
}

// The two-build reproducibility gate: normalized filesystem, binary and dependency
// digests must be identical and no packaging/time difference is allowed.
export function compareBuilds(first, second) {
  for (const side of [first, second]) {
    const allowed = side?.allowedDifferences ?? [];
    check(Array.isArray(allowed) && allowed.length === 0, 'allowed reproducibility differences');
  }
  check(first?.normalized && second?.normalized, 'normalized build results');
  for (const key of ['filesystemDigest', 'binaryDigest', 'dependenciesDigest']) {
    check(hash(first.normalized[key]) && first.normalized[key] === second.normalized[key],
      `reproducibility mismatch: ${key}`);
  }
  return { reproducible: true, allowedDifferences: [] };
}
