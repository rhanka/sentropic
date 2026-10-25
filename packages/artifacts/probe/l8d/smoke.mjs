import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve('tmp/l8d');
const consumer = `${out}/consumer`;
mkdirSync(consumer, { recursive: true });
const { tuple } = JSON.parse(readFileSync(`${out}/tuple.json`));
const dependencies = Object.fromEntries(tuple.map((p) => [p.name, `file:${p.path}`]));
const overrides = { ...dependencies };
Object.assign(dependencies, { '@sentropic/oauth-verify': '0.1.0', hono: '4.13.13', jose: '5.10.0',
  typescript: '5.4.5', '@types/node': '24.0.0' });
writeFileSync(`${consumer}/package.json`, JSON.stringify({ private: true,
  type: 'module', dependencies, overrides }));
copyFileSync('packages/artifacts/probe/l8d/runtime.mjs', `${consumer}/runtime.mjs`);
writeFileSync(`${consumer}/types.mts`, [
  'import type { ArtifactInvocationContext } from "@sentropic/artifacts/server/commit-contract";',
  'import type { ArtifactOutcome } from "@sentropic/artifacts/server/outcome-contract";',
  'import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from "@sentropic/artifacts/mcp-core";',
  'import { createArtifactCommitBarrier } from "@sentropic/artifacts/testing";',
  'const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);',
  'const barrier = createArtifactCommitBarrier();',
  'export type Probe = [ArtifactInvocationContext, ArtifactOutcome<unknown>, typeof profile, typeof barrier];',
].join('\n'));
const results = [];
for (const [command, args] of [
  ['npm', ['install', '--strict-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund']],
  ['npm', ['ci', '--strict-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund']],
  ['node', ['runtime.mjs']],
  ['node', ['node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'types.mts']],
]) {
  const result = spawnSync(command, args, { cwd: consumer, encoding: 'utf8' });
  const log = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  results.push({ command: `${command} ${args.join(' ')}`, exitCode: result.status ?? 1, log });
  console.log(log);
}
const lock = readFileSync(`${consumer}/package-lock.json`);
writeFileSync(`${out}/smoke.json`, JSON.stringify({ results,
  status: results.every((r) => r.exitCode === 0) ? 'passed' : 'known_failure',
  lockSha256: createHash('sha256').update(lock).digest('hex'),
}, null, 2));
if (results.some((r) => r.exitCode !== 0)) process.exitCode = 1;
