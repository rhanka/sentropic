import { cpSync, existsSync, globSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Read-only external dependencies; never use a sibling @sentropic package's sources or dist.
cpSync('/offline-tools', '/tmp/contract-tools', { recursive: true, dereference: false });
rmSync('/tmp/contract-tools/@sentropic', { recursive: true, force: true });
mkdirSync('/tmp/contract-tools/@sentropic');
symlinkSync('/workspace/packages/mcp-platform', '/tmp/contract-tools/@sentropic/mcp-platform');
const root = resolve('packages/artifacts');
const modules = `${root}/node_modules`;
rmSync(modules, { recursive: true, force: true });
symlinkSync('/tmp/contract-tools', modules);
const tool = (name, args, cwd = root) => execFileSync(process.execPath,
  [`/tmp/contract-tools/${name}`, ...args], { cwd, stdio: 'inherit' });
try {
  console.log('OFFLINE_TOOLCHAIN', Object.fromEntries(['typescript', 'vitest', 'pg', '@aws-sdk/client-s3'].map(
    (name) => [name, JSON.parse(readFileSync(`/tmp/contract-tools/${name}/package.json`)).version])));
  const [gate, scope] = process.argv.slice(2);
  if (gate === 'offline-build') {
    const platformModules = resolve('packages/mcp-platform/node_modules');
    rmSync(platformModules, { recursive: true, force: true });
    symlinkSync('/tmp/contract-tools', platformModules);
    try {
    tool('typescript/bin/tsc', ['-p', 'tsconfig.json'], resolve('packages/mcp-platform'));
    } finally { rmSync(platformModules, { force: true }); }
    tool('typescript/bin/tsc', ['-p', 'tsconfig.json']);
    tool('typescript/bin/tsc', ['--noEmit', '--strict', '--skipLibCheck', '--target', 'es2022',
      '--module', 'nodenext', '--moduleResolution', 'nodenext', '--verbatimModuleSyntax',
      ...['commit', 'failure', 'profile', 'command-identity'].map((name) => `l0-freeze/${name}-contract.ts`)]);
  } else if (gate === 'offline-packed') {
    process.env.ARTIFACTS_OFFLINE_TOOLS = '/tmp/contract-tools';
    execFileSync(process.execPath, ['--test', `${root}/probe/packed-example.test.mjs`], { stdio: 'inherit' });
  } else {
    const files = scope ? scope.split(' ') : gate === 'offline-unit' ? ['tests'] :
      [...globSync('tests/*.integration.test.ts', { cwd: root }), ...globSync('tests/*.e2e.test.ts', { cwd: root })];
    tool('vitest/vitest.mjs', ['run', ...files, '--environment', 'node',
      ...(gate === 'offline-unit' ? ['--exclude', '**/*.integration.test.ts', '--exclude', '**/*.e2e.test.ts'] :
        ['--no-file-parallelism'])]);
  }
} finally { if (existsSync(modules)) rmSync(modules, { force: true }); }
