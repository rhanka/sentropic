import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync } from 'node:zlib';

export const profiles = {
  typical: { portable: 409600, initial: 409600, js: 307200, optional: 131072, release: 524288 },
  governance: { portable: 8388608, initial: 8388608, js: 7340032, optional: 131072, release: 9437184 },
};
export function fileReceipt(bytes) {
  return { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes).length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const filesUnder = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)]);
const inlineJsBytes = html => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(([, attributes]) => !/\bsrc\s*=/.test(attributes)
    && /^(?:module|(?:text|application)\/(?:java|ecma)script)?$/i.test(/\btype=["']([^"']+)["']/i.exec(attributes)?.[1] ?? ''))
  .reduce((total, [, , code]) => total + Buffer.byteLength(code), 0);

export function measureArtifact({ directory, portablePath, startupPaths = [], profile = 'typical' }) {
  const limits = profiles[profile];
  if (!limits) throw new Error(`Unknown artifact profile: ${profile}`);
  const manifest = JSON.parse(readFileSync(join(directory, '.vite/manifest.json')));
  const byFile = new Map(Object.entries(manifest).map(([key, value]) => [value.file, key]));
  const paths = new Set(filesUnder(directory).map(file => relative(directory, file).replaceAll('\\', '/'))
    .filter(path => !path.startsWith('.vite/') && join(directory, path) !== portablePath));
  const violations = [];
  const addClosure = (keys, dynamic, output = new Set()) => {
    const visited = new Set();
    const visit = key => {
      if (visited.has(key)) return;
      visited.add(key);
      const chunk = manifest[key];
      if (!chunk) { violations.push(`Missing manifest entry: ${key}`); return; }
      for (const file of [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]) output.add(file);
      for (const dependency of [...(chunk.imports ?? []), ...(dynamic ? chunk.dynamicImports ?? [] : [])]) visit(dependency);
    };
    keys.forEach(visit);
    return output;
  };
  const entries = Object.keys(manifest).filter(key => manifest[key].isEntry);
  if (!entries.length) violations.push('No initial entry in manifest');
  const initial = addClosure(entries, false, new Set(['index.html']));
  const full = addClosure(entries, true, new Set(['index.html']));
  const html = readFileSync(join(directory, 'index.html'), 'utf8');
  const htmlPaths = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
  for (const input of [...htmlPaths, ...startupPaths]) {
    if (/^(?:data:|#)/.test(input)) continue;
    if (/^(?:\w+:|\/\/)/.test(input)) { violations.push(`External startup dependency: ${input}`); continue; }
    const path = input.replace(/^\.?\//, '').split(/[?#]/)[0];
    initial.add(path); full.add(path);
    if (byFile.has(path)) addClosure([byFile.get(path)], false, initial);
  }
  for (const path of initial) full.add(path);
  for (const path of full) if (!paths.has(path)) violations.push(`Missing deployed asset: ${path}`);
  for (const path of paths) if (!full.has(path)) violations.push(`Unreferenced deployed asset: ${path}`);
  const files = [...paths].sort().map(path => ({ path, ...fileReceipt(readFileSync(join(directory, path))),
    initial: initial.has(path), dynamic: !initial.has(path),
    importers: Object.entries(manifest).filter(([, m]) => [...(m.imports ?? []), ...(m.dynamicImports ?? [])]
      .some(key => manifest[key]?.file === path)).map(([, m]) => m.file) }));
  const sum = predicate => files.filter(predicate).reduce((total, file) => total + file.raw, 0);
  const portableBytes = readFileSync(portablePath);
  const portable = { path: portablePath, ...fileReceipt(portableBytes), inlineExecutableJs: inlineJsBytes(portableBytes.toString('utf8')) };
  const totals = { portable: portable.raw, initial: sum(file => file.initial),
    js: sum(file => file.initial && file.path.endsWith('.js')) + inlineJsBytes(html), release: sum(() => true) };
  if (portable.inlineExecutableJs > limits.js)
    violations.push(`Portable executable JS: ${portable.inlineExecutableJs} > ${limits.js} bytes`);
  for (const metric of ['portable', 'initial', 'js', 'release']) {
    if (totals[metric] > limits[metric]) violations.push(`${metric}: ${totals[metric]} > ${limits[metric]} bytes`);
  }
  for (const file of files) {
    if (file.dynamic && file.path.endsWith('.js') && file.raw > limits.optional)
      violations.push(`Optional chunk ${file.path}: ${file.raw} > ${limits.optional} bytes`);
    if (file.path.endsWith('.map')) violations.push(`Source map in runtime release: ${file.path}`);
  }
  return { schemaVersion: 1, profile, limits, totals, portable, files, startupPaths, violations,
    agentReadCost: { portable: portable.raw, hosted: totals.release,
      rule: 'Bytes of every file the publishing agent must read; inline JS/data counted inside HTML once; non-gating' } };
}

export function reportTable(report) {
  return ['| Metric | Raw bytes | Limit |', '|---|---:|---:|',
    ...Object.entries(report.totals).map(([key, value]) => `| ${key} | ${value} | ${report.limits[key]} |`),
    `| agent read cost (portable / hosted; non-gating) | ${report.agentReadCost.portable} / ${report.agentReadCost.hosted} | — |`,
    '', ...report.violations.map(message => `- FAIL: ${message}`)].join('\n');
}
