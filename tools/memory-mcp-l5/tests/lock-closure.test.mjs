import { readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildP1Closure, resolveLockKey, P1_CONSUMERS } from '../lock-closure.mjs';
import { p1Fixture } from './p1-fixture.mjs';

const scan = root => spawnSync(process.execPath, ['tools/memory-mcp-l5/import-graph.mjs', '--mode', 'packed', '--root', root, '--manifest', 'manifest.json'], { encoding: 'utf8' });
const TOOLS = new Set(['typescript', '@types/node', '@microsoft/api-extractor']);

function syntheticLock() {
  const node = (version, name, extra = {}) => ({
    version, resolved: `https://registry.npmjs.org/${name}.tgz`, integrity: `sha512-${name}==`, ...extra,
  });
  return {
    lockfileVersion: 3,
    packages: {
      'packages/mcp-platform': { version: '0.3.1',
        dependencies: { '@modelcontextprotocol/sdk': '^1.31.0' },
        devDependencies: { typescript: '5.4.5', '@types/node': '^22.10.10', '@microsoft/api-extractor': '^7.58.9', vitest: '4.1.0' } },
      'packages/mcp-broker': { version: '0.1.0',
        dependencies: { '@sentropic/mcp-platform': '^0.3.1' },
        devDependencies: { typescript: '5.4.5', '@types/node': '^22.10.10', vitest: '4.1.0' } },
      'node_modules/@sentropic/mcp-platform': { resolved: 'packages/mcp-platform', link: true },
      'node_modules/@modelcontextprotocol/sdk': node('1.32.1', 'sdk', { dependencies: { zod: '^3.0.0' } }),
      'node_modules/typescript': node('5.4.5', 'ts'),
      'node_modules/@types/node': node('22.20.1', 'node', { dependencies: { 'undici-types': '~6.21.0' } }),
      'node_modules/undici-types': node('6.21.0', 'u'),
      'node_modules/zod': node('3.25.0', 'zod'),
      'node_modules/vitest': node('4.1.0', 'vitest'),
      'node_modules/@microsoft/api-extractor': node('7.58.9', 'ae', { dependencies: { jju: '^1.0.0' } }),
      'node_modules/jju': node('1.4.0', 'jju'),
    },
  };
}

function gated(mut) {
  const f = p1Fixture();
  try {
    const lock = JSON.parse(readFileSync(`${f.root}/package-lock.json`, 'utf8'));
    mut(lock, f);
    f.put('package-lock.json', JSON.stringify(lock));
    return scan(f.root);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
}

describe('lock-closure — per-consumer resolved dependency closure', () => {
  it('resolves each consumer independently through npm ancestor walk', () => {
    const packages = syntheticLock().packages;
    expect(resolveLockKey(packages, 'packages/mcp-platform', '@modelcontextprotocol/sdk')).toBe('node_modules/@modelcontextprotocol/sdk');
    expect(resolveLockKey(packages, 'packages/mcp-platform', 'missing-dep')).toBe(null);
    expect(P1_CONSUMERS).toEqual(['packages/mcp-platform', 'packages/mcp-broker']);
    const closure = buildP1Closure(syntheticLock(), TOOLS);
    expect(Object.keys(closure).sort()).toEqual([...P1_CONSUMERS].sort());
    expect(closure['packages/mcp-platform'].deps['@modelcontextprotocol/sdk'].version).toBe('1.32.1');
    expect(closure['packages/mcp-broker'].deps['@sentropic/mcp-platform']).toEqual({ link: 'packages/mcp-platform' });
    expect(closure['packages/mcp-broker'].deps['@modelcontextprotocol/sdk']).toBe(undefined);
    expect(closure['packages/mcp-platform'].deps.vitest).toBe(undefined);
    expect(closure['packages/mcp-broker'].deps.vitest).toBe(undefined);
  });

  it.each([
    ['identical nested duplicate passes', (l) => { l.packages['packages/mcp-platform/node_modules/typescript'] = { ...l.packages['node_modules/typescript'] }; }, true],
    ['nested SDK shadow changes the closure', (l) => { l.packages['packages/mcp-platform/node_modules/@modelcontextprotocol/sdk'] = { ...l.packages['node_modules/@modelcontextprotocol/sdk'], version: '1.33.0' }; }, false],
    ['broker nested TypeScript drift shadowed by a platform copy', (l) => {
      l.packages['packages/mcp-platform/node_modules/typescript'] = { ...l.packages['node_modules/typescript'] };
      l.packages['packages/mcp-broker/node_modules/typescript'] = { ...l.packages['node_modules/typescript'], integrity: 'sha512-changed==' };
    }, false],
    ['build-tool transitive drift changes the closure', (l) => { l.packages['node_modules/undici-types'].integrity = 'sha512-changed=='; }, false],
    ['non-tool transitive drift is out of scope', (l) => { l.packages['node_modules/zod'].integrity = 'sha512-changed=='; }, true],
    ['test-runner drift is out of scope', (l) => { l.packages['node_modules/vitest'].version = '4.2.0'; }, true],
    ['removed record resolves to null', (l) => { delete l.packages['node_modules/typescript']; }, false],
  ])('%s', (_, mutate, identical) => {
    const lock = syntheticLock();
    mutate(lock);
    const result = JSON.stringify(buildP1Closure(lock, TOOLS));
    const base = JSON.stringify(buildP1Closure(syntheticLock(), TOOLS));
    if (identical) expect(result).toBe(base);
    else expect(result).not.toBe(base);
  });

  it('accepts the packed gate after an unrelated lockfile edit or a harmless hoisting copy', () => {
    for (const mut of [
      (lock) => { lock.packages['node_modules/some-unrelated-pkg'] = { version: '9.9.9', resolved: 'https://r/u.tgz', integrity: 'sha512-u==' }; },
      (lock) => { lock.packages['packages/mcp-platform/node_modules/typescript'] = { ...lock.packages['node_modules/typescript'] }; },
    ]) {
      expect(gated(mut).status).toBe(0);
    }
  });

  it.each([
    ['nested SDK shadow', (lock) => { lock.packages['packages/mcp-platform/node_modules/@modelcontextprotocol/sdk'] = { ...lock.packages['node_modules/@modelcontextprotocol/sdk'], version: '1.33.0' }; }],
    ['broker nested TypeScript drift shadowed by a platform copy', (lock) => {
      lock.packages['packages/mcp-platform/node_modules/typescript'] = { ...lock.packages['node_modules/typescript'] };
      lock.packages['packages/mcp-broker/node_modules/typescript'] = { ...lock.packages['node_modules/typescript'], integrity: 'sha512-changed==' };
    }],
    ['undici-types integrity drift', (lock) => { lock.packages['node_modules/undici-types'] = { ...lock.packages['node_modules/undici-types'], integrity: 'sha512-changed==' }; }],
  ])('refuses the packed gate on %s', (_, mut) => {
    const r = gated(mut);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/lock fingerprint mismatch/);
  });
});
