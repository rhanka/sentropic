import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const versions = { artifacts: '0.2.4', 'cluster-mesh': '0.22.4', 'llm-mesh': '0.28.1', 'llm-gateway': '0.21.3' };
const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
function payload(directory, prefix = '') {
  return Object.fromEntries(readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name, 'en')).flatMap(entry => {
    const path = join(prefix, entry.name), absolute = join(directory, entry.name);
    assert.equal(entry.isSymbolicLink(), false, path);
    return entry.isDirectory() ? Object.entries(payload(absolute, path)) : [[path, digest(readFileSync(absolute))]];
  }));
}
const receipts = {};
for (const [name, version] of Object.entries(versions)) {
  const response = await fetch(`https://registry.npmjs.org/@sentropic%2f${name}/${version}`);
  assert.equal(response.ok, true);
  const metadata = await response.json();
  const archiveResponse = await fetch(metadata.dist.tarball);
  assert.equal(archiveResponse.ok, true);
  const bytes = Buffer.from(await archiveResponse.arrayBuffer());
  const sri = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  assert.equal(sri, metadata.dist.integrity);
  if (name === 'artifacts') assert.equal(sri,
    'sha512-AMXfnuKVx5gdeFppZ4iSgb0KxmfH+qSOotm/cXGBKGEdhyv9R/D05jMhefP5pIW9HwD/jbEWqcU9Gv3KTxJSQQ==');
  const directory = mkdtempSync('/tmp/w0-payload-');
  try {
    writeFileSync(join(directory, 'published.tgz'), bytes);
    execFileSync('tar', ['-xzf', join(directory, 'published.tgz'), '-C', directory]);
    const published = payload(join(directory, 'package'));
    const publishedManifest = JSON.parse(readFileSync(join(directory, 'package/package.json')));
    const publishedText = Object.fromEntries(Object.keys(published).filter(p => p.endsWith('.d.ts'))
      .map(p => [p, readFileSync(join(directory, 'package', p), 'utf8')]));
    rmSync(join(directory, 'package'), { recursive: true });
    const candidate = `/out/workspace-payload/sentropic-${name}-${version}.tgz`;
    execFileSync('tar', ['-xzf', candidate, '-C', directory]);
    const source = payload(join(directory, 'package'));
    const sourceManifest = JSON.parse(readFileSync(join(directory, 'package/package.json')));
    const differences = [...new Set([...Object.keys(source), ...Object.keys(published)])]
      .filter(path => source[path] !== published[path]);
    receipts[name] = { version, metadata: { name: metadata.name, version: metadata.version,
      gitHead: metadata.gitHead ?? null, dist: metadata.dist, dependencies: metadata.dependencies,
      peerDependencies: metadata.peerDependencies, exports: metadata.exports },
      archiveSha256: digest(bytes), candidateArchiveSha256: digest(readFileSync(candidate)),
      published, source, differences, publishedManifest, sourceManifest,
      declarationDifferences: differences.filter(p => p.endsWith('.d.ts')).map(path => ({ path,
        published: publishedText[path], source: readFileSync(join(directory, 'package', path), 'utf8') })) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
writeFileSync('/out/payload-equivalence.json', JSON.stringify({ observedAt: new Date().toISOString(), receipts }));
for (const [name, receipt] of Object.entries(receipts)) {
  console.log(JSON.stringify({ name, files: Object.keys(receipt.published).length, differences: receipt.differences }));
  const allowedDeclarations = { 'cluster-mesh': 'dist/storage/root-facade.d.ts',
    'llm-gateway': 'dist/request-receipts.d.ts' };
  assert.deepEqual(receipt.differences.filter(path => path !== 'package.json' &&
    path !== allowedDeclarations[name]), [], name);
  const canonicalUnion = text => text.replace(/"[^"]+"(?: \| "[^"]+")+/g,
    union => union.split(' | ').sort().join(' | '));
  for (const difference of receipt.declarationDifferences) {
    assert.equal(canonicalUnion(difference.source), canonicalUnion(difference.published), difference.path);
  }
  // Publication metadata may differ; exported/runtime contracts must be identical.
  for (const field of ['name', 'version', 'type', 'main', 'types', 'exports', 'files', 'dependencies',
    'peerDependencies', 'peerDependenciesMeta']) {
    assert.deepEqual(receipt.sourceManifest[field], receipt.publishedManifest[field], `${name}.${field}`);
  }
}
