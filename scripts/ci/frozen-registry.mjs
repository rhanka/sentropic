// Registry metadata comes exclusively from committed lock records and explicit candidate archives.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export function addLock(versions, lock) {
  for (const [location, record] of Object.entries(lock.packages ?? {})) {
    if (!location.includes('node_modules/') || record.link || !record.integrity) continue;
    if (!record.resolved?.startsWith('https://registry.npmjs.org/')) continue;
    const name = record.name ?? location.split('node_modules/').at(-1);
    const entries = versions.get(name) ?? new Map();
    const previous = entries.get(record.version);
    if (previous && previous.dist.integrity !== record.integrity) throw new Error(`Conflicting locked integrity: ${name}@${record.version}`);
    entries.set(record.version, { ...record, name, dist: { tarball: record.resolved, integrity: record.integrity } });
    versions.set(name, entries);
  }
}

export function lockedVersions(root) {
  const versions = new Map();
  addLock(versions, JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'))));
  for (const profile of Object.values(JSON.parse(fs.readFileSync(path.join(root, 'scripts/ci/tool-locks.json'))))) {
    addLock(versions, profile.lock);
  }
  const selected = path.join(root, 'packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json');
  if (fs.existsSync(selected)) addLock(versions, JSON.parse(fs.readFileSync(selected)));
  return versions;
}

export function candidateArchives(args, cwd) {
  const archives = new Set();
  const directories = new Set([cwd]);
  for (const arg of args) {
    const value = arg.replace(/^file:/, '');
    if (value.endsWith('.tgz')) {
      const file = path.resolve(cwd, value);
      if (fs.existsSync(file)) { archives.add(file); directories.add(path.dirname(file)); }
    }
  }
  // Candidate dependencies may be supplied by the sibling archives beside the primary archive.
  for (const dir of [...directories]) {
    if (fs.existsSync(path.join(dir, 'src'))) directories.add(path.join(dir, 'src'));
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      const doc = JSON.parse(fs.readFileSync(manifest));
      for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'overrides']) {
        for (const spec of Object.values(doc[section] ?? {})) {
          if (typeof spec === 'string' && spec.startsWith('file:') && spec.endsWith('.tgz')) {
            const file = path.resolve(dir, spec.slice(5));
            if (fs.existsSync(file)) { archives.add(file); directories.add(path.dirname(file)); }
          }
        }
      }
    }
  }
  for (const dir of directories) for (const entry of fs.readdirSync(dir)) {
    if (entry.endsWith('.tgz')) archives.add(path.join(dir, entry));
  }
  return [...archives];
}

export async function frozenRegistry(versions, archives = []) {
  const candidates = archives.map(file => {
    const bytes = fs.readFileSync(file);
    const manifest = JSON.parse(execFileSync('tar', ['-xOf', file, 'package/package.json'], { maxBuffer: 8 * 1024 * 1024 }));
    return { file, bytes, manifest, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
  });
  const server = http.createServer(async (req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname.slice(1));
    const candidate = candidates.find(c => `__candidate/${c.integrity}` === name);
    if (candidate) { res.end(candidate.bytes); return; }
    // npm can rewrite registry.npmjs.org URLs from an existing lock to this registry.
    if (name.includes('/-/')) {
      const record = [...versions.values()].flatMap(entries => [...entries.values()])
        .find(entry => decodeURIComponent(new URL(entry.dist.tarball).pathname.slice(1)) === name);
      if (!record) { res.writeHead(404); res.end('Tarball is outside the committed locks'); return; }
      try {
        const response = await fetch(record.dist.tarball);
        if (!response.ok) throw new Error(`Locked tarball HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const [algorithm, expected] = record.dist.integrity.split('-', 2);
        if (createHash(algorithm).update(bytes).digest('base64') !== expected) throw new Error('Locked tarball integrity mismatch');
        res.end(bytes);
      } catch (error) { res.writeHead(502); res.end(error.message); }
      return;
    }
    const entries = new Map(versions.get(name) ?? []);
    for (const c of candidates.filter(c => c.manifest.name === name)) entries.set(c.manifest.version, {
      ...c.manifest, dist: { integrity: c.integrity, tarball: `${url}/__candidate/${encodeURIComponent(c.integrity)}` },
    });
    res.setHeader('content-type', 'application/json');
    if (!entries.size) { res.writeHead(404); res.end(JSON.stringify({ error: `No committed lock or candidate for ${name}` })); return; }
    const latest = [...entries.keys()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).at(-1);
    res.end(JSON.stringify({ name, versions: Object.fromEntries(entries), 'dist-tags': { latest } }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, candidates, close: () => new Promise(resolve => server.close(resolve)) };
}
