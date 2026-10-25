import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { suites, validateSuite } from './receipt.mjs';

const out = resolve('tmp/l8d');
const radar = `${out}/radar`;
mkdirSync(`${out}/results`, { recursive: true });
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const { tuple, tupleDigest } = json(`${out}/tuple.json`);
const install = json(`${out}/install.json`);
for (const archive of tuple) {
  if (digest(readFileSync(archive.path)) !== archive.sha256) throw new Error(`altered ${archive.name}`);
}
const evidence = [];
// One host invocation covers all three required host files and the remaining host suites.
for (const scope of [...suites.slice(0, 5), 'host']) {
  const host = scope === 'host';
  const name = host ? 'host' : scope.split('/').at(-1).replace('.spec.ts', '');
  const reportPath = `${out}/results/${name}.json`;
  const cwd = host ? `${radar}/packages/artifacts-host` : `${radar}/api`;
  const args = ['run', 'test', '--', ...(host ? [] : [scope.replace(/^api\//, '')]),
    '--reporter=default', '--reporter=json', `--outputFile.json=${reportPath}`];
  const result = install.status !== 'passed'
    ? { status: 1, stderr: '[blocked] strict full-Radar installation failed; suite not executed' }
    : spawnSync('npm', args, { cwd, encoding: 'utf8', env: {
    ...process.env, NODE_ENV: 'test', ARTIFACTS_PROVIDER_ACCEPTANCE: '1',
    POSTGRES_HOST: 'postgres', POSTGRES_PORT: '5432', POSTGRES_USER: 'app',
    POSTGRES_PASSWORD: 'app', POSTGRES_DB: 'app', S3_ENDPOINT: 'http://minio:9000',
    S3_REGION: 'us-east-1', S3_ACCESS_KEY: 'minioadmin', S3_SECRET_KEY: 'minioadmin',
  } });
  const log = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ?? ''}`;
  writeFileSync(`${out}/results/${name}.log`, log);
  const report = existsSync(reportPath) ? json(reportPath) : { testResults: [] };
  for (const path of host ? suites.slice(5) : [scope]) {
    const item = { path, sourceSha256: digest(readFileSync(`${radar}/${path}`)), gate: 1,
      command: `npm ${args.join(' ')} (inside make radar ENV=test-861-l8d)`,
      exitCode: result.status ?? 1, log, logSha256: digest(log), report, status: 'passed' };
    try { item.executed = validateSuite(item); }
    catch (error) {
      item.status = install.status === 'passed' ? 'known_failure' : 'not_covered';
      item.reason = install.status === 'passed' ? error.message : result.stderr;
    }
    evidence.push(item);
    console.log(item.status, path, item.reason ?? `${item.executed} cases`);
  }
}
const sourceCommit = readFileSync(`${out}/source-commit`, 'utf8').trim();
const own = { lane: 'L8d', sourceCommit, tupleDigest,
  status: evidence.every((s) => s.status === 'passed') ? 'passed' : 'known_failure' };
const shards = ['L8a', 'L8b', 'L8c'].map((lane) => {
  const path = `${out}/shards/${lane}.json`;
  return existsSync(path) ? json(path) : { lane, status: 'not_covered', reason: 'shard not delivered' };
});
const receipt = { kind: 'packed-candidate', sourceCommit, tuple, tupleDigest,
  image: 'node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6',
  radarPins: { integration: 'b2b802b5', A1: 'f2b6c25cc9458ec285d6d4f620a55dad8c30f909',
    A2: 'b104ae90a28a5581e8eabd15f12acb58558d3396', acceptance: 'e2e9515ea41baebf5539743f0cfa0dea750d072c' },
  install, suites: evidence, shards: [...shards, own] };
receipt.smoke = existsSync(`${out}/smoke.json`) ? json(`${out}/smoke.json`)
  : { status: 'not_covered', reason: 'packed smoke not run' };
receipt.imageSmoke = { status: 'not_covered',
  reason: 'Pinned Radar image-smoke uses raw docker build/run, forbidden by machine Docker lock; consumer runner owner must migrate it to Compose.' };
writeFileSync(`${out}/receipt.json`, JSON.stringify(receipt, null, 2));
if (own.status !== 'passed') process.exitCode = 1;
