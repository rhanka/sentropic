import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Qualify the exact two adapter inputs without installing unrelated workspace tools.
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const names = ['@hono/node-server', 'hono'];
const dependencies = Object.fromEntries(names.map(name => [name, lock.packages[`node_modules/${name}`].version]));
const dir = fs.mkdtempSync('/tmp/hono-security-');
const manifest = { name: 'hono-security-regression', version: '1.0.0', private: true, dependencies };
const packages = { '': manifest };
for (const name of names) {
  const key = `node_modules/${name}`;
  packages[key] = { ...lock.packages[key] };
  delete packages[key].dev;
  delete packages[key].peer;
}
fs.writeFileSync(`${dir}/package.json`, JSON.stringify(manifest));
fs.writeFileSync(`${dir}/package-lock.json`, JSON.stringify({ name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages }));
execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', dir], { stdio: 'inherit' });
execFileSync('node', ['--test', 'scripts/security/hono-node-server.test.mjs'], {
  stdio: 'inherit', env: { ...process.env, HONO_TEST_ROOT: dir },
});
