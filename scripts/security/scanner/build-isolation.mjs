import { lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { requireContract as check } from './contract-schema.mjs';
import { offlineGoEnvironment } from './offline-dependencies.mjs';

export const DEFAULT_SOCKET_PATHS = ['/var/run/docker.sock', '/run/docker.sock',
  '/run/podman/podman.sock', '/var/run/buildkit/buildkitd.sock', '/run/containerd/containerd.sock'];

const FORBIDDEN_ENV_KEY = /TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|OIDC|DOCKER|REGISTRY|SIGNING|PRIVATE|AWS_|AZURE_|GOOGLE_/i;

// The build subprocess environment is constructed from scratch; nothing from
// process.env is inherited, so no credential, OIDC or daemon variable can leak in.
export function buildEnvironment({ work, proxyDir, goRoot, toolDirs = [] } = {}) {
  check(typeof work === 'string' && isAbsolute(work), 'work directory');
  check(Array.isArray(toolDirs) && toolDirs.every(dir => isAbsolute(dir)), 'tool directories');
  const env = { PATH: '/usr/bin:/bin', HOME: join(work, 'home'), TMPDIR: join(work, 'tmp'), LANG: 'C', LC_ALL: 'C' };
  if (goRoot) {
    check(typeof proxyDir === 'string' && isAbsolute(proxyDir), 'proxy directory');
    const go = offlineGoEnvironment(work, proxyDir, goRoot);
    Object.assign(env, { GOMODCACHE: go.GOMODCACHE, GOCACHE: go.GOCACHE, GOPROXY: go.GOPROXY, GOSUMDB: go.GOSUMDB,
      GOVCS: go.GOVCS, GOTOOLCHAIN: go.GOTOOLCHAIN, GOENV: go.GOENV, GOWORK: go.GOWORK,
      GOTELEMETRY: go.GOTELEMETRY, GOFLAGS: go.GOFLAGS });
    env.PATH = go.PATH;
  }
  env.PATH = [...toolDirs, env.PATH].join(':');
  return env;
}

// Proves the effective build environment carries no credential, no OIDC request
// material, no shared daemon socket and no Python interpreter before any build
// command runs. A refusal here fences the whole build.
export async function probeIsolation({ env, root, socketPaths = DEFAULT_SOCKET_PATHS } = {}) {
  check(env && typeof env === 'object' && !Array.isArray(env), 'build environment');
  check(typeof root === 'string' && isAbsolute(root), 'sandbox root');
  check(await realpath(root) === resolve(root), 'sandbox root symlink');
  for (const key of Object.keys(env)) check(!FORBIDDEN_ENV_KEY.test(key), `forbidden environment key: ${key}`);
  check(!('ACTIONS_ID_TOKEN_REQUEST_URL' in env) && !('ACTIONS_ID_TOKEN_REQUEST_TOKEN' in env),
    'OIDC request environment');
  for (const socketPath of socketPaths) {
    const stat = await lstat(socketPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    check(!stat, `shared daemon socket: ${socketPath}`);
  }
  const pathDirs = String(env.PATH ?? '').split(':').filter(Boolean);
  check(pathDirs.length > 0, 'build PATH');
  for (const dir of pathDirs) {
    const entries = await readdir(dir).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const name of entries) check(!/^python(\d+(\.\d+)*)?$/.test(name), `python on build PATH: ${join(dir, name)}`);
  }
  return Object.freeze({ credentials: false, oidc: false, sharedSocket: false, python: false });
}
