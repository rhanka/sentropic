import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile, chmod, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEnvironment, probeIsolation, DEFAULT_SOCKET_PATHS } from './build-isolation.mjs';

async function workdir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'scanner-iso-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('should build a sanitized environment that inherits no process env and passes the probe', async t => {
  const work = await workdir(t);
  process.env.SCANNER_TEST_TOKEN = 'must-not-leak';
  t.after(() => { delete process.env.SCANNER_TEST_TOKEN; });
  const env = buildEnvironment({ work, proxyDir: join(work, 'proxy'), goRoot: join(work, 'go'), toolDirs: ['/tools/bin'] });
  assert.ok(!('SCANNER_TEST_TOKEN' in env));
  assert.ok(env.PATH.startsWith('/tools/bin:'));
  assert.ok(env.PATH.includes('/usr/bin:/bin'));
  assert.equal(env.HOME, join(work, 'home'));
  assert.equal(env.TMPDIR, join(work, 'tmp'));
  assert.equal(env.GOPROXY.startsWith('file://'), true);
  assert.equal(env.GOSUMDB, 'off');
  assert.equal(env.GOVCS, '*:off');
  assert.equal(env.GOTOOLCHAIN, 'local');
  assert.deepEqual(await probeIsolation({ env, root: work }), { credentials: false, oidc: false, sharedSocket: false, python: false });
  const bare = buildEnvironment({ work });
  assert.deepEqual(Object.keys(bare).sort(), ['HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR']);
  assert.deepEqual(await probeIsolation({ env: bare, root: work }), { credentials: false, oidc: false, sharedSocket: false, python: false });
});

test('should refuse credential, OIDC and docker environment keys before any build command', async t => {
  const work = await workdir(t);
  const base = buildEnvironment({ work });
  for (const key of ['GITHUB_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL',
    'DOCKER_HOST', 'REGISTRY_PASSWORD', 'SCANNER_SECRET', 'AWS_ACCESS_KEY_ID']) {
    await assert.rejects(probeIsolation({ env: { ...base, [key]: 'x' }, root: work }), /scanner-contract/);
  }
});

test('should refuse a shared daemon socket at any probed path', async t => {
  const work = await workdir(t);
  const env = buildEnvironment({ work });
  const socketPath = join(work, 'docker.sock');
  const server = createServer();
  await new Promise(resolve => server.listen(socketPath, resolve));
  t.after(() => server.close());
  await assert.rejects(probeIsolation({ env, root: work, socketPaths: [socketPath] }), /scanner-contract/);
  await assert.rejects(probeIsolation({ env, root: work, socketPaths: [...DEFAULT_SOCKET_PATHS, socketPath] }), /scanner-contract/);
  server.close();
  await assert.doesNotReject(probeIsolation({ env, root: work, socketPaths: [join(work, 'plain-file')] }));
  await writeFile(join(work, 'plain-file'), 'not a socket');
  await assert.rejects(probeIsolation({ env, root: work, socketPaths: [join(work, 'plain-file')] }), /scanner-contract/);
});

test('should refuse any python interpreter reachable on the build PATH', async t => {
  const work = await workdir(t);
  const bin = join(work, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'python3'), '#!/bin/sh\n');
  await chmod(join(bin, 'python3'), 0o755);
  const env = { ...buildEnvironment({ work }), PATH: `${bin}:/usr/bin:/bin` };
  await assert.rejects(probeIsolation({ env, root: work }), /scanner-contract/);
  await rm(join(bin, 'python3'));
  await writeFile(join(bin, 'python'), '');
  await chmod(join(bin, 'python'), 0o755);
  await assert.rejects(probeIsolation({ env, root: work }), /scanner-contract/);
  await assert.doesNotReject(probeIsolation({ env: { PATH: '/nonexistent-dir' }, root: work }));
  await symlink('/usr/bin/env', join(work, 'link'));
  await assert.rejects(probeIsolation({ env, root: join(work, 'link') }), /scanner-contract/);
});
