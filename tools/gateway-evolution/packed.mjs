import * as fs from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { checkManifest, assertNoDuplicateKeys, GatewayInputError } from './run.mjs';
import { inspectArchive } from './archive.mjs';
import { readConfined } from './transfer.mjs';
const fail = (message, code) => { throw new GatewayInputError(message, code); };
export const packedScope = (scope, names) => {
  const prefix = 'tools/gateway-evolution/packed';
  if (scope === prefix) return names.filter((name) => name.endsWith('.test.ts'));
  if (!scope.startsWith(`${prefix}/`) || scope.slice(prefix.length + 1) !== basename(scope)
    || !names.includes(basename(scope)) || !scope.endsWith('.test.ts')) fail('exact packed test scope required', 'bad-scope');
  return [basename(scope)];
};
/** Stage verified archives/tests; execution happens in a second container with no repo mount. */
export const preparePackedGate = async ({ manifestPath, scope, output }) => {
  if (!/^tmp\/gw-packed-[A-Za-z0-9]+$/.test(output)) fail('owned staging directory required', 'bad-path');
  const text = (await fs.readFile(manifestPath)).toString(); assertNoDuplicateKeys(text);
  const manifest = checkManifest(JSON.parse(text), { expectImageReference: 'node:24-bookworm-slim', expectImageDigest: '0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6' });
  if (manifest.kind === 'tool-only') fail('real package manifest required', 'bad-manifest');
  const archives = new Map();
  for (const artifact of manifest.artifacts ?? []) {
    if (!artifact.path.endsWith('.tgz')) continue;
    const bytes = await readConfined(dirname(resolve(manifestPath)), artifact.path);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== artifact.size || digest !== artifact.sha256) fail('packed bytes mismatch', 'digest-mismatch');
    const packed = inspectArchive(bytes);
    if (!['@sentropic/llm-mesh', '@sentropic/llm-gateway'].includes(packed.name)) continue;
    const row = manifest.packages?.find((entry) => entry.name === packed.name && entry.version === packed.version && entry.tarballSha256 === digest);
    if (!row || row.integrity !== `sha512-${createHash('sha512').update(bytes).digest('base64')}` || archives.has(packed.name)) fail('packed tuple mismatch', 'tuple-mismatch');
    archives.set(packed.name, { bytes, version: packed.version, integrity: row.integrity });
  }
  if (archives.size !== 2) fail('exact gateway and mesh archives required', 'candidate-input-unavailable');
  const source = 'tools/gateway-evolution/packed';
  const entries = await fs.readdir(source, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const tests = packedScope(scope, names);
  if (!tests.length) fail('zero discovered packed tests', 'bad-scope');
  await fs.mkdir(join(output, 'artifacts'), { recursive: true });
  await fs.mkdir(join(output, 'packed'));
  const dependencies = {}; const expected = {};
  for (const [name, archive] of archives) {
    const file = `${name.slice('@sentropic/'.length)}.tgz`;
    await fs.writeFile(join(output, 'artifacts', file), archive.bytes, { flag: 'wx' });
    dependencies[name] = `file:artifacts/${file}`;
    expected[name] = { version: archive.version, integrity: archive.integrity };
  }
  for (const name of names.filter((name) => /\.(ts|mjs)$/.test(name))) {
    await fs.writeFile(join(output, 'packed', name), await readConfined(source, name), { flag: 'wx' });
  }
  await fs.writeFile(join(output, 'package.json'), JSON.stringify({ name: 'gateway-packed-consumer', private: true, type: 'module', dependencies,
    devDependencies: { typescript: '5.9.3', '@types/node': '22.10.10' } }), { flag: 'wx' });
  await fs.writeFile(join(output, 'expected.json'), JSON.stringify(expected), { flag: 'wx' });
  await fs.writeFile(join(output, 'scopes.json'), JSON.stringify(tests.map((name) => `packed/${name}`)), { flag: 'wx' });
  await fs.writeFile(join(output, 'execute.mjs'), EXECUTE, { flag: 'wx' });
  return { tests, packages: Object.keys(expected) };
};
const EXECUTE = `import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const expected=JSON.parse(await readFile('expected.json','utf8'));
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
const found=new Set();
for(const [location,row] of Object.entries(lock.packages)) {
  if(!location) continue;
  const pkg=JSON.parse(await readFile(location+'/package.json','utf8'));
  if(!pkg.name.startsWith('@sentropic/')) continue;
  assert.ok(expected[pkg.name], 'unexpected external package');
  assert.equal(pkg.version, expected[pkg.name].version);
  assert.equal(row.integrity, expected[pkg.name].integrity);
  found.add(pkg.name);
}
assert.deepEqual([...found].sort(), Object.keys(expected).sort());
const scopes=JSON.parse(await readFile('scopes.json','utf8'));
assert.ok(scopes.length);
const result=spawnSync(process.execPath,['--test',...scopes],{stdio:'inherit'});
process.exit(result.status ?? 1);
`;
