import { cpSync, existsSync, globSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Read-only external dependencies; never use a sibling @sentropic package's sources or dist.
const tools = '/tmp/contract-tools/node_modules';
cpSync('/offline-tools', tools, { recursive: true, dereference: false });
rmSync(`${tools}/@sentropic`, { recursive: true, force: true });
// Cached npm archive, verified before extraction; Node 20 declarations lack the required Headers global.
const nodeIntegrity = 'zJRE40jpHtKqE/C4fgHrAKQLJuSpzEnP9ff9Y7YtoR3Wd2pwqzlekDeEuUQXjRd+QCYnVnNwuJYmhdk9XV8gvA==';
const nodeHash = Buffer.from(nodeIntegrity, 'base64').toString('hex');
const nodeArchive = `/offline-cache/content-v2/sha512/${nodeHash.slice(0, 2)}/${nodeHash.slice(2, 4)}/${nodeHash.slice(4)}`;
assert.equal(createHash('sha512').update(readFileSync(nodeArchive)).digest('base64'), nodeIntegrity);
rmSync(`${tools}/@types/node`, { recursive: true, force: true });
mkdirSync(`${tools}/@types/node`);
execFileSync('tar', ['-xzf', nodeArchive, '--strip-components=1', '-C', `${tools}/@types/node`]);
mkdirSync(`${tools}/@sentropic`);
symlinkSync('/workspace/packages/mcp-platform', `${tools}/@sentropic/mcp-platform`);
const root = resolve('packages/artifacts');
const modules = `${root}/node_modules`;
rmSync(modules, { recursive: true, force: true });
symlinkSync(tools, modules);
const tool = (name, args, cwd = root) => execFileSync(process.execPath,
  [`${tools}/${name}`, ...args], { cwd, stdio: 'inherit' });
try {
  console.log('OFFLINE_TOOLCHAIN', Object.fromEntries(['typescript', 'vitest', 'pg', '@aws-sdk/client-s3'].map(
    (name) => [name, JSON.parse(readFileSync(`${tools}/${name}/package.json`)).version])));
  const [gate, scope] = process.argv.slice(2);
  if (gate === 'offline-build') {
    const platformModules = resolve('packages/mcp-platform/node_modules');
    rmSync(platformModules, { recursive: true, force: true });
    symlinkSync(tools, platformModules);
    try {
    tool('typescript/bin/tsc', ['-p', 'tsconfig.json'], resolve('packages/mcp-platform'));
    } finally { rmSync(platformModules, { force: true }); }
    tool('typescript/bin/tsc', ['-p', 'tsconfig.json']);
    tool('typescript/bin/tsc', ['--noEmit', '--strict', '--skipLibCheck', '--target', 'es2022',
      '--module', 'nodenext', '--moduleResolution', 'nodenext', '--verbatimModuleSyntax',
      ...['commit', 'failure', 'profile', 'command-identity'].map((name) => `l0-freeze/${name}-contract.ts`)]);
  } else if (gate === 'offline-packed') {
    process.env.ARTIFACTS_OFFLINE_TOOLS = tools;
    execFileSync(process.execPath, ['--test', `${root}/probe/packed-example.test.mjs`], { stdio: 'inherit' });
  } else {
    const files = scope ? scope.split(' ') : gate === 'offline-unit' ? ['tests'] :
      [...globSync('tests/*.integration.test.ts', { cwd: root }), ...globSync('tests/*.e2e.test.ts', { cwd: root })];
    tool('vitest/vitest.mjs', ['run', ...files, '--environment', 'node',
      ...(gate === 'offline-unit' ? ['--exclude', '**/*.integration.test.ts', '--exclude', '**/*.e2e.test.ts'] :
        ['--no-file-parallelism'])]);
  }
} finally { if (existsSync(modules)) rmSync(modules, { force: true }); }
