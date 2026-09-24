import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authFixture, now } from './fixtures/auth-hono.js';

// Runs only inside the Docker-backed Make target; no workspace links enter these installs.
const temp = mkdtempSync(join(tmpdir(), 'gateway-auth-isolation-'));
const candidate = join(temp, 'candidate');
const toolModules = dirname(realpathSync('node_modules/vitest'));
const tsc = join(toolModules, 'typescript/bin/tsc');
const run = (command: string, args: string[], cwd: string) => execFileSync(command, args, {
  cwd, encoding: 'utf8', timeout: 120_000,
  env: { ...process.env, NODE_PATH: '', npm_config_cache: join(temp, 'cache') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let tarball: string;
let servicePublished = false;

beforeAll(() => {
  cpSync('package.json', join(temp, 'manifest.json'));
  run(process.execPath, [tsc, '-p', 'tsconfig.json', '--outDir', join(candidate, 'dist')], process.cwd());
  for (const file of ['package.json', 'README.md', 'LICENSE']) cpSync(file, join(candidate, file));
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temp], candidate));
  tarball = join(temp, packed[0].filename);
  try {
    const metadata = JSON.parse(run('npm', ['view', '@sentropic/mcp-auth@0.2.1', '--json'], temp));
    servicePublished = metadata.version === '0.2.1';
  } catch (error) {
    // Only the conductor-approved publication absence is a pending gate; network failures fail.
    if (!String((error as { stderr?: string }).stderr).includes('E404')) throw error;
  }
}, 180_000);
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const install = (mode: string, peers: string[] = []) => {
  const dir = mkdtempSync(join(temp, `${mode}-`));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund',
    tarball, '@types/node@22.20.1', ...peers], dir);
  return dir;
};
const check = (dir: string, source: string) => {
  writeFileSync(join(dir, 'check.mts'), source);
  run(process.execPath, [tsc, '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution',
    'NodeNext', '--target', 'ES2022', 'check.mts'], dir);
  return run(process.execPath, ['--input-type=module', '-e', source], dir);
};

describe('optional auth subpaths in clean npm consumers', () => {
  it('loads root runtime and declarations without any auth peer', () => {
    const dir = install('root');
    for (const peer of ['@sentropic/mcp-auth', '@sentropic/auth-hono', 'jose']) {
      expect(existsSync(join(dir, 'node_modules', peer))).toBe(false);
    }
    check(dir, "import { VerifiedCostContextResolver } from '@sentropic/llm-gateway'; new VerifiedCostContextResolver();");
    // Selected subpath import is lazy even when its peer is absent; verification fails closed.
    const output = run(process.execPath, ['--input-type=module', '-e', `
      import { ServiceAuthVerifyToken } from '@sentropic/llm-gateway/auth';
      const verifier = new ServiceAuthVerifyToken({ auth: { issuer: 'https://i.test', resource: 'https://g.test',
        requiredScopes: ['invoke'], ports: { dpopReplay: { recordDpopJti() {} } } }, resolvePrincipal() {} });
      try { await verifier.verify('t', 'Bearer', { authorization: 'Bearer t' },
        { method: 'GET', url: 'https://g.test/v1/models', requestId: 'r' }); } catch (e) { console.log(e.kind); }
    `], dir);
    expect(output.trim()).toBe('caller-auth-unavailable');
  }, 180_000);
  it('qualifies session declarations/runtime without mcp-auth', () => {
    const dir = install('session', ['@sentropic/auth-hono@0.15.0', 'jose@5.10.0',
      'zod@3.25.76', '@hono/zod-validator@0.7.5', '@simplewebauthn/server@13.2.2']);
    expect(existsSync(join(dir, 'node_modules/@sentropic/mcp-auth'))).toBe(false);
    check(dir, "import { AuthHonoVerifyToken } from '@sentropic/llm-gateway/auth-hono'; void AuthHonoVerifyToken;");
  }, 180_000);
  it('qualifies service-only 0.2.1, transitive oauth-verify and required jose', async ctx => {
    if (!servicePublished) { ctx.skip(); return; }
    const dir = install('service', ['@sentropic/mcp-auth@0.2.1', 'jose@5.10.0']);
    expect(existsSync(join(dir, 'node_modules/@sentropic/auth-hono'))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'node_modules/jose/package.json'), 'utf8')).version).toBe('5.10.0');
    check(dir, "import { ServiceAuthVerifyToken } from '@sentropic/llm-gateway/auth'; void ServiceAuthVerifyToken;");
    const f = await authFixture();
    const token = await f.token();
    const key = await f.auth.ports.jwks.getActiveKey();
    const source = `import { ServiceAuthVerifyToken } from '@sentropic/llm-gateway/auth';
      const auth = ${JSON.stringify({ issuer: f.auth.issuer, resource: f.auth.resource, requiredScopes: f.auth.requiredScopes })};
      auth.ports = { clock: { now: () => new Date('${now.toISOString()}') },
        jwks: { findKeyByKid: async () => (${JSON.stringify(key)}) }, dpopReplay: { recordDpopJti: async () => true } };
      const verifier = new ServiceAuthVerifyToken({ auth, resolvePrincipal: () => ({ principalId: 'verified' }) });
      try { console.log((await verifier.verify('${token}', 'Bearer', { authorization: 'Bearer ${token}' },
        { method: 'GET', url: '${f.auth.resource}/v1/models', requestId: 'r' }))?.principalId); }
      catch (e) { console.log(e.kind); }`;
    expect(run(process.execPath, ['--input-type=module', '-e', source], dir).trim()).toBe('verified');
    rmSync(join(dir, 'node_modules/jose'), { recursive: true });
    expect(run(process.execPath, ['--input-type=module', '-e', source], dir).trim()).toBe('caller-auth-unavailable');
  }, 180_000);
});
