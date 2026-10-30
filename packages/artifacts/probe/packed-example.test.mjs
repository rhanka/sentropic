import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
  const offline = process.env.ARTIFACTS_OFFLINE_TOOLS;
  if (offline) {
    execFileSync(process.execPath, ['/workspace/scripts/ci/locked-consumer.mjs', '--prefix', consumer, '--ignore-scripts', '--strict-peer-deps',
      '--offline', '--no-audit', '--no-fund', archive,
      resolve('tools/memory-mcp-l5/artifacts/archives/sentropic-mcp-platform-0.4.0-2ad8a40fa38f4289fe177f58d75bc3317a50dd1b7a3ca693cf55cff2ff72cc9d.tgz')], { stdio: 'inherit' });
    for (const name of readdirSync(offline).filter((name) => name !== '@sentropic' && name !== '.bin')) {
      cpSync(`${offline}/${name}`, `${consumer}/node_modules/${name}`, { recursive: true });
    }
    mkdirSync(`${consumer}/node_modules/.bin`, { recursive: true });
    copyFileSync(`${offline}/typescript/bin/tsc`, `${consumer}/node_modules/typescript/bin/tsc`);
  } else execFileSync(process.execPath, ['/workspace/scripts/ci/locked-consumer.mjs', '--prefix', consumer, '--ignore-scripts', '--strict-peer-deps',
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
import { ArtifactOperationError, type ArtifactHostFailureMapper } from '@sentropic/artifacts/server/outcome-contract';
import type { HttpAppDeps } from '@sentropic/artifacts/http';
import { createArtifactsToolExecutor, type ArtifactsAdapterOptions } from '@sentropic/artifacts/mcp-core';
const mapHostError: ArtifactHostFailureMapper = cause =>
  new ArtifactOperationError('provider_unavailable', { cause });
const httpMapper: Pick<HttpAppDeps, 'mapHostError'> = { mapHostError };
const mcpMapper: Pick<ArtifactsAdapterOptions, 'mapHostError'> = { mapHostError };
const coordinatorMapper: Pick<CommitCoordinatorOptions, 'mapHostError'> = { mapHostError };
declare const deps: Parameters<typeof createArtifactsToolExecutor>[0];
createArtifactsToolExecutor({ ...deps, mapHostError });
export { httpMapper, mcpMapper, coordinatorMapper };
const executor: (pool: Parameters<typeof createPostgresCommitExecutor>[0]) => CommitExecutor = createPostgresCommitExecutor;
export { executor, inspectPreparations, scheduleBoundedPreparationCleanup, pausePurgeBeforeDelete, inspectDeletionClaims };
export type { CommitCoordinatorOptions, ArtifactPolicyDriver, CoordinatorTestPoint };
`);
  execFileSync(process.execPath, [`${consumer}/node_modules/typescript/bin/tsc`, '--noEmit', '--strict', '--skipLibCheck',
    '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext',
    '--verbatimModuleSyntax', `${consumer}/example.ts`, `${consumer}/public-types.ts`], { stdio: 'pipe' });
  console.log(JSON.stringify(receipt));
});
