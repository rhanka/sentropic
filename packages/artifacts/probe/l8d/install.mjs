import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve('tmp/l8d');
const radar = `${out}/radar`;
const { tuple } = JSON.parse(readFileSync(`${out}/tuple.json`));
for (const path of ['package.json', 'api/package.json', 'packages/artifacts-host/package.json',
  'packages/immo-mcp/package.json']) {
  const file = `${radar}/${path}`;
  const pkg = JSON.parse(readFileSync(file));
  for (const entry of tuple) {
    if (path === 'package.json' || pkg.dependencies?.[entry.name]) {
      (pkg.dependencies ??= {})[entry.name] = `file:${entry.path}`;
    }
  }
  if (path === 'package.json') {
    // Full Radar keeps all workspaces and known llm-mesh 0.19.2 peers.
    Object.assign(pkg.dependencies, { '@sentropic/llm-mesh': '0.19.2',
      '@sentropic/oauth-verify': '0.1.0', hono: '4.13.13', jose: '5.10.0' });
    for (const entry of tuple) (pkg.overrides ??= {})[entry.name] = `file:${entry.path}`;
  }
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}
let status = 'failed';
try {
  for (const args of [['install', '--package-lock-only'], ['ci']]) {
    execFileSync('npm', [...args, '--strict-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: radar, stdio: 'inherit' });
  }
  status = 'passed';
} finally {
  const lockSha256 = createHash('sha256').update(readFileSync(`${radar}/package-lock.json`)).digest('hex');
  writeFileSync(`${out}/install.json`, JSON.stringify({ status, strictPeerDeps: true,
    lockSha256, sourceLinks: false, tuple }, null, 2));
}
