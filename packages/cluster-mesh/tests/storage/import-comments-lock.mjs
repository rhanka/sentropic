import { readFileSync, writeFileSync } from 'node:fs';
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const manifest = read('packages/cluster-mesh/package.json');
const source = read('.h2a/comments-deps/package-lock.json');
const peer = source.packages['node_modules/@sentropic/comments'];
if (peer.version !== '0.3.0' || peer.integrity !== 'sha512-D/QMnw/MAVF9PnPTZG0VM3ecuFN21US2soyoC6pvw58dXpKu/c64Xdq8lZgTmdl8v9UbY5vIGhLmo5W2NicztQ==') throw new Error('frozen published peer identity changed');
for (const [path, key] of [['package-lock.json', 'packages/cluster-mesh'], ['packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json', 'node_modules/@sentropic/cluster-mesh']]) {
  const lock = read(path);
  lock.packages[key].peerDependencies['@sentropic/comments'] = manifest.peerDependencies['@sentropic/comments'];
  lock.packages[key].peerDependenciesMeta['@sentropic/comments'] = { optional: true };
  if (key.startsWith('node_modules/')) {
    lock.packages[''].dependencies['@sentropic/comments'] = '0.3.0';
    lock.packages['node_modules/@sentropic/comments'] = peer;
    for (const name of ['@sentropic/contracts', 'hono', 'zod']) {
      const entry = `node_modules/${name}`;
      if (!lock.packages[entry]) lock.packages[entry] = source.packages[entry];
    }
  }
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
}
