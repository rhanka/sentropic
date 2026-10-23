// lock-closure.mjs — effective per-consumer resolution closure over package-lock.json.
//
// Each P1 consumer (packages/mcp-platform, packages/mcp-broker) resolves its declared
// dependencies independently following npm's ancestor walk, so a nested record that shadows
// the root installation changes that consumer's closure. Only resolved records
// ({version, resolved, integrity}) are hashed — never range strings — and traversal below
// the direct dependencies continues transitively inside the build-toolchain subtree (every
// descendant of a package the Makefile build actually installs), so unrelated runtime
// subtrees cannot invalidate P1. The test runner (`vitest`) is excluded: it qualifies P1
// but never feeds the packed bytes.
export const P1_CONSUMERS = ['packages/mcp-platform', 'packages/mcp-broker'];

export const TEST_ONLY_DEPS = ['vitest'];

export function resolveLockKey(packages, fromKey, name) {
  const dirs = [fromKey];
  let dir = fromKey;
  while (dir.includes('/')) {
    dir = dir.slice(0, dir.lastIndexOf('/'));
    dirs.push(dir);
  }
  if (dirs[dirs.length - 1] !== '') dirs.push('');
  for (const candidate of dirs) {
    const key = candidate === '' ? `node_modules/${name}` : `${candidate}/node_modules/${name}`;
    if (Object.prototype.hasOwnProperty.call(packages, key)) return key;
  }
  return null;
}

function projectNode(packages, key) {
  const entry = packages[key];
  if (!entry || typeof entry !== 'object') return null;
  if (entry.link) return { link: typeof entry.resolved === 'string' ? entry.resolved : null };
  return {
    version: typeof entry.version === 'string' ? entry.version : null,
    resolved: typeof entry.resolved === 'string' ? entry.resolved : null,
    integrity: typeof entry.integrity === 'string' ? entry.integrity : null,
  };
}

function declaredNames(entry) {
  const names = new Set();
  if (entry && typeof entry === 'object') {
    for (const map of [entry.dependencies, entry.devDependencies]) {
      if (map && typeof map === 'object') for (const name of Object.keys(map)) names.add(name);
    }
  }
  for (const excluded of TEST_ONLY_DEPS) names.delete(excluded);
  return [...names].sort();
}

function childNames(entry) {
  const names = new Set();
  if (entry && typeof entry === 'object') {
    for (const map of [entry.dependencies, entry.optionalDependencies]) {
      if (map && typeof map === 'object') for (const name of Object.keys(map)) names.add(name);
    }
  }
  return [...names].sort();
}

function projectToolchainNode(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.link) return { link: typeof entry.resolved === 'string' ? entry.resolved : null };
  const node = {
    version: typeof entry.version === 'string' ? entry.version : null,
    resolved: typeof entry.resolved === 'string' ? entry.resolved : null,
    integrity: typeof entry.integrity === 'string' ? entry.integrity : null,
  };
  for (const map of ['dependencies', 'optionalDependencies']) {
    if (entry[map] && typeof entry[map] === 'object' && entry[map] !== null) node[map] = { ...entry[map] };
  }
  return node;
}

// buildToolchainClosure — content projection of one resolved toolchain installation.
//
// The snapshot is already the minimal install the producing build consumes, so every
// record is projected by lock key: resolved versions, registries, integrity values and
// dependency edges. Any added, removed or altered record changes the projection.
export function buildToolchainClosure(lockDoc) {
  const packages = lockDoc && typeof lockDoc.packages === 'object' && lockDoc.packages !== null ? lockDoc.packages : {};
  const closure = {};
  for (const key of Object.keys(packages).sort()) {
    if (key === '') continue;
    closure[key] = projectToolchainNode(packages[key]);
  }
  return closure;
}

export function buildP1Closure(lockDoc, recurseNames) {
  const packages = lockDoc && typeof lockDoc.packages === 'object' && lockDoc.packages !== null ? lockDoc.packages : {};
  const tools = recurseNames instanceof Set ? recurseNames : new Set(recurseNames || []);
  const memo = new Map();
  const active = new Set();
  const expand = (key, name, inToolchain) => {
    if (key === null) return null;
    const entered = inToolchain || tools.has(name);
    if (memo.has(key)) {
      const prior = memo.get(key);
      const locked = prior === null || typeof prior !== 'object' || prior.link || 'deps' in prior || 'cycle' in prior;
      if (!entered || locked) return prior;
      memo.delete(key);
    }
    if (active.has(key)) return { cycle: key };
    const base = projectNode(packages, key);
    if (!base || base.link) {
      memo.set(key, base);
      return base;
    }
    active.add(key);
    let node = base;
    if (entered) {
      const names = childNames(packages[key]);
      if (names.length > 0) {
        node = { ...base, deps: {} };
        for (const child of names) node.deps[child] = expand(resolveLockKey(packages, key, child), child, true);
      }
    }
    active.delete(key);
    memo.set(key, node);
    return node;
  };
  const closure = {};
  for (const consumer of P1_CONSUMERS) {
    const entry = packages[consumer];
    const deps = {};
    for (const name of declaredNames(entry)) deps[name] = expand(resolveLockKey(packages, consumer, name), name, false);
    closure[consumer] = {
      version: entry && typeof entry.version === 'string' ? entry.version : null,
      deps,
    };
  }
  return closure;
}
