import { readFileSync, writeFileSync } from 'node:fs';

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const source = read('.h2a/storage-deps/package-lock.json');
const manifest = read('packages/cluster-mesh/package.json');
if (manifest.dependencies['@stablelib/sha256'] !== '2.0.1') throw new Error('declare the pinned digest dependency first');
const entries = Object.entries(source.packages).filter(([key]) => key.startsWith('node_modules/@stablelib/'));
if (entries.length !== 5) throw new Error('unexpected digest dependency closure');
for (const [, value] of entries) {
  if (!value.resolved.startsWith('https://registry.npmjs.org/@stablelib/') || !value.integrity.startsWith('sha512-') || value.license !== 'MIT') throw new Error('unexpected digest registry identity');
}
const outputs = [];
for (const [file, packageKey] of [
  ['package-lock.json', 'packages/cluster-mesh'],
  ['packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json', 'node_modules/@sentropic/cluster-mesh'],
]) {
  const lock = read(file);
  if (!lock.packages[packageKey]) throw new Error(`missing cluster-mesh identity in ${file}`);
  const dependencies = { ...lock.packages[packageKey].dependencies, '@stablelib/sha256': '2.0.1' };
  lock.packages[packageKey].dependencies = Object.fromEntries(Object.entries(dependencies).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  const additions = new Map(entries);
  const ordered = {};
  for (const [key, value] of Object.entries(lock.packages)) {
    for (const [added, metadata] of additions) if (added < key && !Object.hasOwn(lock.packages, added)) { ordered[added] = metadata; additions.delete(added); }
    if (additions.has(key)) {
      if (JSON.stringify(value) !== JSON.stringify(additions.get(key))) throw new Error(`conflicting pre-existing digest entry ${key}`);
      additions.delete(key);
    }
    ordered[key] = value;
  }
  for (const [key, value] of additions) ordered[key] = value;
  lock.packages = ordered;
  outputs.push([file, `${JSON.stringify(lock, null, 2)}\n`]);
}
for (const [file, contents] of outputs) writeFileSync(file, contents);
