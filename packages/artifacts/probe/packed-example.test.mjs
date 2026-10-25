import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('packed Radar example compiles using only installed public entrypoints', () => {
  const out = resolve('tmp/contract-gaps');
  mkdirSync(out, { recursive: true });
  const [pack] = JSON.parse(execFileSync('npm', ['pack', './packages/artifacts', '--json',
    '--ignore-scripts', '--pack-destination', out], { encoding: 'utf8' }));
  const archive = resolve(out, pack.filename);
  const bytes = readFileSync(archive);
  const receipt = { name: pack.name, version: pack.version, archive,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
  assert.equal(receipt.integrity, pack.integrity);
  writeFileSync(`${out}/pack-receipt.json`, JSON.stringify(receipt, null, 2));
  assert.ok(pack.files.some(({ path }) => path === 'examples/radar-commit-setup.ts'));
  const consumer = mkdtempSync(`${tmpdir()}/artifacts-public-example-`);
  writeFileSync(`${consumer}/package.json`, JSON.stringify({ private: true, type: 'module' }));
  execFileSync('npm', ['install', '--prefix', consumer, '--ignore-scripts', '--strict-peer-deps',
    '--no-audit', '--no-fund', archive, 'typescript@5.4.5', '@types/node@22',
    'pg@8.22.0', '@types/pg@8.20.0', '@sentropic/mcp-platform@0.4.0'], { stdio: 'pipe' });
  const installed = `${consumer}/node_modules/@sentropic/artifacts`;
  copyFileSync(`${installed}/examples/radar-commit-setup.ts`, `${consumer}/example.ts`);
  writeFileSync(`${consumer}/public-types.ts`, `
import { createPostgresCommitExecutor } from '@sentropic/artifacts/adapters/postgres-commit';
import type { CommitExecutor, CommitCoordinatorOptions, ArtifactPolicyDriver,
  CoordinatorTestPoint } from '@sentropic/artifacts/server/commit-contract';
import { inspectPreparations, scheduleBoundedPreparationCleanup } from '@sentropic/artifacts/server/object-intents';
import { pausePurgeBeforeDelete, inspectDeletionClaims } from '@sentropic/artifacts/testing';
const executor: (pool: Parameters<typeof createPostgresCommitExecutor>[0]) => CommitExecutor = createPostgresCommitExecutor;
export { executor, inspectPreparations, scheduleBoundedPreparationCleanup, pausePurgeBeforeDelete, inspectDeletionClaims };
export type { CommitCoordinatorOptions, ArtifactPolicyDriver, CoordinatorTestPoint };
`);
  execFileSync(`${consumer}/node_modules/.bin/tsc`, ['--noEmit', '--strict', '--skipLibCheck',
    '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext',
    '--verbatimModuleSyntax', `${consumer}/example.ts`, `${consumer}/public-types.ts`], { stdio: 'pipe' });
  console.log(JSON.stringify(receipt));
});
