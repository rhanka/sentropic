import { posix } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { isForbiddenImport } from './receipt.mjs';

export function readArchive(bytes) {
  const tar = gunzipSync(bytes), files = new Map();
  if (tar.length < 1024 || tar.length % 512) throw new Error('invalid tar length');
  for (let off = 0; off + 512 <= tar.length;) {
    const header = tar.subarray(off, off + 512);
    if (header.every(b => b === 0)) {
      if (!tar.subarray(off).every(b => b === 0)) throw new Error('invalid tar trailer');
      return files;
    }
    const string = (start, end) => header.subarray(start, end).toString().replace(/\0.*$/, '');
    const name = [string(345, 500), string(0, 100)].filter(Boolean).join('/');
    const rawSize = string(124, 136).trim(), size = Number.parseInt(rawSize, 8);
    const sum = header.reduce((n, b, i) => n + (i >= 148 && i < 156 ? 32 : b), 0);
    if (string(257, 262) !== 'ustar' || Number.parseInt(string(148, 156).trim(), 8) !== sum ||
        !/^[0-7]+$/.test(rawSize) || !Number.isSafeInteger(size) || off + 512 + size > tar.length ||
        ![0, 48].includes(header[156]) || !name.startsWith('package/') || name.includes('\\') ||
        name.split('/').some(p => p === '..' || p === '.' || !p) || files.has(name)) throw new Error(`invalid tar member ${name}`);
    files.set(name.slice(8), tar.subarray(off + 512, off + 512 + size));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('missing tar trailer');
}

export const graphRoots = packages => [...packages.values()].flatMap(pkg => {
  const entry = pkg.manifest.exports?.['./memory'];
  if (!entry || typeof entry.types !== 'string' || typeof entry.import !== 'string') throw new Error('missing public memory export');
  return [entry.import, entry.types].map(p => `${pkg.prefix}/${p.replace(/^\.\//, '')}`);
});

/** Shared traversal for staged P1 bytes, extracted archives and real negative fixture graphs. */
export function scanGraph(files, roots, packages = new Map()) {
  const queue = [...roots], visited = new Set(), edges = [], failures = [];
  while (queue.length) {
    const from = queue.shift();
    if (visited.has(from)) continue;
    const bytes = files.get(from);
    if (!bytes) { failures.push(`unresolved graph file ${from}`); continue; }
    visited.add(from);
    if (isForbiddenImport(from) || /(?:^|\/)(?:experimental|testing|mock|memory-reference)(?:[/.]|$)/.test(from)) failures.push(`forbidden graph file ${from}`);
    const code = String(bytes);
    if (/\b(?:import|require)\s*\(\s*(?!['"][^'"]+['"]\s*\))/.test(code)) failures.push(`computed dynamic edge in ${from}`);
    const specs = [
      ...[...code.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map(m => m[1]),
      ...[...code.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]),
    ];
    for (const spec of new Set(specs)) {
      if (isForbiddenImport(spec) || /cluster-mesh|better-sqlite3|memory-reference/.test(spec)) { failures.push(`forbidden edge ${spec} in ${from}`); continue; }
      if (spec.startsWith('node:')) { edges.push({ from, specifier: spec, to: spec }); continue; }
      let target;
      if (spec.startsWith('.')) {
        target = posix.normalize(posix.join(posix.dirname(from), spec));
        const owner = [...packages.values()].find(p => from.startsWith(`${p.prefix}/`));
        if (owner && !target.startsWith(`${owner.prefix}/`)) { failures.push(`sibling source edge ${spec}`); continue; }
      } else {
        const parts = spec.split('/'), name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
        const pkg = packages.get(name), subpath = `./${parts.slice(name.startsWith('@') ? 2 : 1).join('/')}`;
        const exported = pkg?.manifest.exports?.[subpath === './' ? '.' : subpath];
        const entry = typeof exported === 'string' ? exported : exported?.[from.endsWith('.d.ts') ? 'types' : 'import'];
        if (entry) target = posix.join(pkg.prefix, entry);
      }
      const stem = target?.replace(/\.js$/, '');
      const candidates = from.endsWith('.d.ts') ? [`${stem}.d.ts`, target] : [target, `${stem}.ts`, `${target}.ts`, `${target}/index.ts`];
      const to = candidates.find(p => files.has(p));
      if (!to) { failures.push(`unresolved edge ${spec} in ${from}`); continue; }
      edges.push({ from, specifier: spec, to }); queue.push(to);
    }
  }
  return { roots, resolvedFiles: [...visited].sort(), edges, failures };
}
