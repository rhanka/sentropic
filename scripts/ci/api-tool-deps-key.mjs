import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// CI10 dependency-base identity (tooldeps-<sha256>) of the api/Dockerfile ci-tool-deps target.
// Inputs: every build-context file its stages copy (deps-manifests, dependencies, ci-tool-base;
// api-tool-deps-key.test.mjs fails on an uncovered COPY), the Dockerfile, .dockerignore and this
// file. Nested fixture manifests and apps/* manifests are never copied into those stages.
// Normalization, sound for npm 11.16 as pinned by the Dockerfile:
// - npm ci reads a workspace's version from its on-disk manifest, never from the lock
//   (arborist load-virtual #resolveLinks), so workspace-local lock entries lose `version`;
//   external entries and every other field are hashed as they are.
// - A workspace version only acts through range edges onto that workspace (dep-valid
//   semver.satisfies); the validity bit of each such edge is hashed in its place.
// - INERT_FIELDS are read neither by npm ci (arborist, bin-links, run-script, package-json
//   normalize) nor by the deps-manifests prune; the image copy of each workspace manifest is
//   shadowed by the source layer (ci-tools COPY --from=base /workspace/packages and api).
// - A spec outside the evaluated subset, an override naming the workspace or a non-strict
//   version keeps that workspace's version (at worst a cache miss, never a false hit).
export const INPUTS = ['.dockerignore', '.security/audit-allowlist.json', '.security/audit-gate.mjs', 'api/Dockerfile',
  'api/package.json', ':(glob)packages/*/package.json', 'package-lock.json', 'package.json',
  'scripts/ci/api-tool-deps-key.mjs', 'scripts/ci/locked-tools.mjs', 'scripts/ci/tool-locks.json'];
export const INERT_FIELDS = ['version', 'description', 'exports', 'files', 'homepage', 'imports', 'keywords', 'main',
  'module', 'publishConfig', 'repository', 'sideEffects', 'types', 'typesVersions', 'typings'];
const MANIFEST = /^(api|packages\/[^/]+)\/package\.json$/;
const EDGES = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'acceptDependencies'];

const NUM = '(0|[1-9]\\d{0,14})';
const ID = '(?:0|[1-9]\\d{0,14}|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const SEMVER = new RegExp(`^${NUM}\\.${NUM}\\.${NUM}(?:-(${ID}(?:\\.${ID})*))?$`);
export const parseVersion = text => {
  const match = typeof text === 'string' && SEMVER.exec(text);
  return match ? { tuple: [+match[1], +match[2], +match[3]], pre: match[4] ? match[4].split('.') : [] } : null;
};
const sign = n => (n > 0) - (n < 0);
const compareId = (a, b) => {
  const [na, nb] = [/^\d+$/.test(a), /^\d+$/.test(b)];
  return na && nb ? sign(a - b) : na !== nb ? (na ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0;
};
const compare = (a, b) => {
  for (let i = 0; i < 3; i++) if (a.tuple[i] !== b.tuple[i]) return sign(a.tuple[i] - b.tuple[i]);
  if (!a.pre.length || !b.pre.length) return sign(b.pre.length - a.pre.length);
  const order = a.pre.map((id, i) => (i < b.pre.length ? compareId(id, b.pre[i]) : 0)).find(Boolean);
  return order ?? sign(a.pre.length - b.pre.length);
};
const OPS = { '=': c => c === 0, '>': c => c > 0, '>=': c => c >= 0, '<': c => c < 0, '<=': c => c <= 0 };
const below = tuple => ({ tuple, pre: ['0'] });
const comparators = token => {
  const [, op = '', text] = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(token);
  const v = parseVersion(text);
  if (!v) return null;
  const [major, minor, patch] = v.tuple;
  if (op === '^') return [['>=', v], ['<', below(major ? [major + 1, 0, 0] : minor ? [0, minor + 1, 0] : [0, 0, patch + 1])]];
  if (op === '~') return [['>=', v], ['<', below([major, minor + 1, 0])]];
  return [[op || '=', v]];
};

// semver.satisfies(version, range, true) for full-version comparator sets (^ ~ = < <= > >= and ||),
// with npm dep-valid's '' / '*' shortcut. null: the spec is outside this subset.
export function satisfies(version, range) {
  if (typeof range !== 'string') return null;
  if (range === '' || range === '*') return true;
  const sets = range.split('||').map(part => part.trim().split(/\s+/).map(comparators));
  if (sets.some(set => set.includes(null))) return null;
  const v = parseVersion(version);
  if (!v) return false;
  return sets.map(set => set.flat()).some(set => set.every(([op, c]) => OPS[op](compare(v, c)))
    && (!v.pre.length || set.some(([, c]) => c.pre.length && c.tuple.every((n, i) => n === v.tuple[i]))));
}

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const parse = bytes => { try { const value = JSON.parse(bytes.toString('utf8')); return isObject(value) ? value : null; } catch { return null; } };
const omit = (object, fields) => Object.fromEntries(Object.entries(object).filter(([key]) => !fields.includes(key)));
const isLocal = key => key !== '' && !/(^|\/)node_modules\//.test(key) && !key.startsWith('../') && !key.startsWith('/');
const dirOf = path => path.slice(0, -'/package.json'.length);
const sha256 = data => createHash('sha256').update(data).digest('hex');

// files: Map of repository path -> file bytes (the INPUTS listing).
export function depsKey(files) {
  const paths = [...files.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const lock = files.has('package-lock.json') ? parse(files.get('package-lock.json')) : null;
  const packages = isObject(lock?.packages) ? lock.packages : {};
  const root = files.has('package.json') ? parse(files.get('package.json')) : null;
  const manifests = new Map(paths.filter(p => MANIFEST.test(p)).map(p => [dirOf(p), parse(files.get(p))]).filter(([, m]) => m));
  const specs = new Map();
  for (const doc of [...Object.values(packages), root, ...manifests.values()]) {
    for (const [name, spec] of EDGES.flatMap(section => Object.entries(isObject(doc?.[section]) ? doc[section] : {}))) {
      specs.set(name, (specs.get(name) ?? new Set()).add(typeof spec === 'string' ? spec : JSON.stringify(spec)));
    }
  }
  const names = new Map();
  const addName = (dir, name) => typeof name === 'string' && names.set(dir, (names.get(dir) ?? new Set()).add(name));
  for (const [key, entry] of Object.entries(packages)) {
    if (isLocal(key)) addName(key, entry?.name);
    else if (entry?.link && key.includes('node_modules/')) addName(entry.resolved, key.slice(key.lastIndexOf('node_modules/') + 13));
  }
  for (const [dir, manifest] of manifests) addName(dir, manifest.name);
  const overrides = JSON.stringify([root?.overrides, ...[...manifests.values()].map(m => m.overrides)]);
  const signature = [];
  const drop = new Set();
  for (const dir of [...new Set([...Object.keys(packages).filter(isLocal), ...manifests.keys()])].sort()) {
    const versions = [packages[dir]?.version, manifests.get(dir)?.version];
    let keep = versions.some(version => version !== undefined && !parseVersion(version));
    const lines = [`${dir}\t${versions.map(version => version !== undefined).join('\t')}`];
    for (const name of [...(names.get(dir) ?? [])].sort()) {
      keep ||= overrides.includes(name);
      for (const spec of [...(specs.get(name) ?? [])].filter(s => !s.startsWith('file:')).sort()) {
        const bits = versions.map(version => satisfies(version, spec));
        keep ||= bits.includes(null);
        lines.push(`${dir}\t${name}\t${spec}\t${bits.join('\t')}`);
      }
    }
    if (!keep) { drop.add(dir); signature.push(...lines); }
  }
  const hash = createHash('sha256');
  for (const path of paths) {
    let bytes = files.get(path);
    if (path === 'package-lock.json' && isObject(lock?.packages)) {
      const entries = Object.entries(packages).map(([key, value]) => [key, drop.has(key) && isObject(value) ? omit(value, ['version']) : value]);
      bytes = JSON.stringify({ ...lock, packages: Object.fromEntries(entries) });
    } else if (MANIFEST.test(path) && manifests.has(dirOf(path))) {
      bytes = JSON.stringify(omit(manifests.get(dirOf(path)), INERT_FIELDS.filter(f => f !== 'version' || drop.has(dirOf(path)))));
    }
    hash.update(`${sha256(bytes)}  ${path}\n`);
  }
  hash.update(`signature ${sha256(signature.join('\n'))}\n`);
  return `tooldeps-${hash.digest('hex')}`;
}

export function readInputs(cwd = process.cwd()) {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--deduplicate', '-z', '--', ...INPUTS],
    { cwd, maxBuffer: 1 << 26 });
  const files = new Map();
  for (const path of listed.toString('utf8').split('\0').filter(Boolean)) {
    // Deleted-but-tracked paths drop out, as with the former `[ -f ]` shell filter.
    if (statSync(join(cwd, path), { throwIfNoEntry: false })?.isFile()) files.set(path, readFileSync(join(cwd, path)));
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(depsKey(readInputs()));
