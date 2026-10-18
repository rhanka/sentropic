import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { scanGraph, graphRoots, readArchive } from './contract-graph.mjs';
import { consumedInventory, integrity, sha256 } from './precandidate.mjs';

/** Stage only the public /memory runtime and declaration closure before npm ever sees it. */
export function packMemoryClosure(root, archivesDir, sourceHead) {
  const packages = new Map(), files = new Map();
  for (const slug of ['mcp-platform', 'mcp-broker']) {
    const prefix = `packages/${slug}`, source = JSON.parse(readFileSync(resolve(root, prefix, 'package.json')));
    const manifest = { name: source.name, version: source.version, type: 'module', license: source.license,
      exports: { './memory': source.exports['./memory'] }, files: ['dist'],
      engines: { node: '^22.13.0 || ^23.4.0 || >=24.0.0' },
      ...(slug === 'mcp-broker' ? { dependencies: { '@sentropic/mcp-platform': source.dependencies['@sentropic/mcp-platform'] } } : {}),
    };
    packages.set(source.name, { prefix, manifest });
    files.set(`${prefix}/package.json`, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    const visit = dir => {
      for (const entry of readdirSync(resolve(root, prefix, dir), { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.isFile() && /\.(js|ts)$/.test(path)) files.set(`${prefix}/${path}`, readFileSync(resolve(root, prefix, path)));
      }
    };
    visit('dist');
  }
  const report = scanGraph(files, graphRoots(packages), packages);
  if (report.failures.length) throw new Error(report.failures.join('\n'));
  const closure = new Set([...report.resolvedFiles, ...[...packages.values()].map(p => `${p.prefix}/package.json`)]);
  const packed = [], packedFiles = new Map();
  mkdirSync(archivesDir, { recursive: true });
  for (const pkg of packages.values()) {
    const stage = mkdtempSync(join(tmpdir(), 'memory-p1-'));
    try {
      for (const path of closure) {
        if (!path.startsWith(`${pkg.prefix}/`)) continue;
        const member = path.slice(pkg.prefix.length + 1);
        mkdirSync(dirname(join(stage, member)), { recursive: true });
        writeFileSync(join(stage, member), files.get(path));
      }
      const receipt = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', archivesDir], { cwd: stage, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0];
      const original = join(archivesDir, receipt.filename), bytes = readFileSync(original), digest = sha256(bytes);
      const destination = original.replace(/\.tgz$/, `-${digest}.tgz`);
      renameSync(original, destination);
      for (const [path, data] of readArchive(bytes)) {
        const full = `${pkg.prefix}/${path}`;
        if (!closure.has(full) || !files.get(full)?.equals(data)) throw new Error(`packed contract drift ${full}`);
        packedFiles.set(full, data);
      }
      packed.push({ role: pkg.manifest.name.endsWith('mcp-platform') ? 'platform' : 'broker', name: pkg.manifest.name,
        version: pkg.manifest.version, sha256: digest, integrity: integrity(bytes), sourceHead,
        archive: `tools/memory-mcp-l5/artifacts/archives/${destination.split('/').pop()}` });
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }
  const packedReport = scanGraph(packedFiles, graphRoots(packages), packages);
  return { packed, inventory: consumedInventory(root, packedFiles, packages, packedReport) };
}
