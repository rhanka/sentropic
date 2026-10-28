import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Refresh only the three changed train entries; preserve all other frozen registry evidence.
const fixture = 'packages/cluster-mesh/tests/packaging/fixtures/selected';
const manifest = JSON.parse(readFileSync(`${fixture}/package.json`, 'utf8'));
const lock = JSON.parse(readFileSync(`${fixture}/package-lock.json`, 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'kev-train-'));
const siblings = [];
for (const slug of ['cluster-mesh', 'llm-mesh', 'llm-gateway']) {
  const pkg = JSON.parse(readFileSync(`packages/${slug}/package.json`, 'utf8'));
  const entry = lock.packages[`node_modules/${pkg.name}`];
  entry.version = pkg.version;
  for (const field of ['dependencies', 'peerDependencies', 'peerDependenciesMeta']) {
    if (pkg[field] === undefined) delete entry[field];
    else entry[field] = Object.fromEntries(Object.entries(pkg[field]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  }
  if (slug === 'cluster-mesh') {
    entry.resolved = manifest.dependencies[pkg.name];
    continue;
  }
  const packed = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch],
    { cwd: `packages/${slug}`, encoding: 'utf8' });
  if (packed.status !== 0) throw new Error(packed.stderr);
  const [archive] = JSON.parse(packed.stdout);
  if (archive.name !== pkg.name || archive.version !== pkg.version) throw new Error('Train archive identity mismatch.');
  siblings.push({ name: pkg.name, version: pkg.version, integrity: archive.integrity });
}
writeFileSync(join(scratch, 'index.json'), JSON.stringify(siblings));
writeFileSync(join(scratch, 'working-lock.json'), JSON.stringify(lock));
const result = spawnSync(process.execPath, ['packages/cluster-mesh/tests/packaging/check-lock-integrity.mjs',
  'refresh', join(scratch, 'working-lock.json'), resolve(`${fixture}/package-lock.json`),
  resolve(`${fixture}/package.json`), scratch], { stdio: 'inherit' });
if (result.status !== 0) throw new Error('Train lock refresh failed.');
console.log('Frozen selected lock refreshed from actual candidate archive integrities.');
