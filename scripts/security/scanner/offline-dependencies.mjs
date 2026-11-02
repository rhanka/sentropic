import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireContract as check, path, CONTRACT_ONLY } from './contract-schema.mjs';

// The retained layout must satisfy the contract path charset, so a proxy path is
// encoded reversibly: '!x' escapes become uppercase letters, '/@v/' collapses to
// '/' and '+' (only legal inside a version segment) becomes '-plus-'. A retained
// proxy path must not natively contain '-plus-'; round-trips are asserted per material.
export function retainedProxyPath(proxyPath) {
  check(typeof proxyPath === 'string' && proxyPath.length > 0, 'proxy path');
  const encoded = proxyPath.replace(/!([a-z])/g, (_, c) => c.toUpperCase())
    .replace('/@v/', '/').replace(/\+/g, '-plus-');
  check(path(encoded), 'retained proxy path charset');
  return encoded;
}
export function proxyPathFromRetained(retained) {
  check(path(retained), 'retained proxy path');
  const decoded = retained.replace(/-plus-/g, '+')
    .replace(/(.*)\/([^/]+)$/, '$1/@v/$2')
    .replace(/([A-Z])/g, (_, c) => `!${c.toLowerCase()}`);
  check(retainedProxyPath(decoded) === retained, 'retained proxy path round-trip');
  return decoded;
}

export function offlineGoEnvironment(work, proxy, compiler) {
  return { PATH: `${compiler}/bin:/usr/bin:/bin`, HOME: join(work, 'home'),
    GOMODCACHE: join(work, 'modcache'), GOCACHE: join(work, 'gocache'),
    GOPROXY: pathToFileURL(proxy).href, GOSUMDB: 'off', GOVCS: '*:off',
    GOTOOLCHAIN: 'local', GOENV: 'off', GOWORK: 'off', GOTELEMETRY: 'off', GOFLAGS: '-mod=readonly' };
}

// Native Go supplies the resolved graph; this check binds it back to the reviewed
// source/sums. It is a candidate replay result, never a content-admission verdict.
export function verifyResolvedModules({ goMod, goSum, modules }) {
  check(typeof goMod === 'string' && typeof goSum === 'string' && Array.isArray(modules) &&
    modules.length > 0, 'Go resolution input');
  check(!/^\s*replace\b/m.test(goMod), 'undeclared module replacement');
  const sums = new Map();
  for (const line of goSum.trim().split('\n')) {
    const fields = line.trim().split(/\s+/);
    check(fields.length === 3 && /^h1:[A-Za-z0-9+/]{43}=$/.test(fields[2]), 'module sum format');
    const key = `${fields[0]} ${fields[1]}`;
    check(!sums.has(key), 'duplicate module checksum');
    sums.set(key, fields[2]);
  }
  const selected = new Map();
  for (const module of modules) {
    check(module && !module.Replace && !module.Error && typeof module.Path === 'string' &&
      typeof module.Version === 'string' && !selected.has(module.Path), 'resolved module identity');
    check(module.Sum && module.GoModSum && sums.get(`${module.Path} ${module.Version}`) === module.Sum &&
      sums.get(`${module.Path} ${module.Version}/go.mod`) === module.GoModSum, 'resolved module checksums');
    selected.set(module.Path, module.Version);
  }
  const required = [...goMod.matchAll(/^\s*(?:require\s+)?([^\s()]+)\s+(v[^\s]+)(?:\s|$)/gm)];
  check(required.length > 0, 'source module requirements');
  for (const [, name, version] of required) check(selected.get(name) === version, 'resolved source requirement');
  check(selected.get('github.com/go-jose/go-jose/v4') === 'v4.1.6' &&
    required.some(([, name, version]) => name === 'github.com/go-jose/go-jose/v4' && version === 'v4.1.6'),
  'embedded Go defect remains after OS-only repair');
  return CONTRACT_ONLY;
}
