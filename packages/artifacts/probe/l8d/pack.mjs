import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve('tmp/l8d');
const packs = `${out}/packs`;
mkdirSync(packs, { recursive: true });
const sha = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const tuple = [];
for (const [slug, version, source] of [
  ['artifacts', '0.2.0', './packages/artifacts'],
  ['cluster-mesh', '0.22.0', './packages/cluster-mesh'],
  ['mcp-platform', '0.4.0', '@sentropic/mcp-platform@0.4.0'],
  ['mcp-auth', '0.2.2', '@sentropic/mcp-auth@0.2.2'],
]) {
  const [packed] = JSON.parse(execFileSync('npm', ['pack', source, '--json',
    '--ignore-scripts', '--pack-destination', packs], { encoding: 'utf8' }));
  assert.equal(packed.name, `@sentropic/${slug}`);
  assert.equal(packed.version, version);
  const path = `${packs}/${packed.filename}`;
  const bytes = readFileSync(path);
  assert.equal(packed.integrity, `sha512-${createHash('sha512').update(bytes).digest('base64')}`);
  tuple.push({ name: packed.name, version, source, path, sha256: sha(bytes), integrity: packed.integrity });
}
writeFileSync(`${out}/tuple.json`, JSON.stringify({ tuple,
  tupleDigest: sha(JSON.stringify(tuple.map(({ name, version, sha256 }) => ({ name, version, sha256 })))),
}, null, 2));
console.log('PACKED_TUPLE_OK', tuple.map((p) => `${p.name}@${p.version}`).join(' '));
