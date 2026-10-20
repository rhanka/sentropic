import { readFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { LOCK_FINGERPRINT_VERSION, P1_BUILD_INPUTS, computeLockFingerprint } from '../lock-fingerprint.mjs';
import { p1Fixture } from './p1-fixture.mjs';

const scan = root => spawnSync(process.execPath, ['tools/memory-mcp-l5/import-graph.mjs', '--mode', 'packed', '--root', root, '--manifest', 'manifest.json'], { encoding: 'utf8' });

function syntheticLock() {
  return {
    lockfileVersion: 3,
    packages: {
      'packages/mcp-platform': { version: '0.3.1', dependencies: { '@modelcontextprotocol/sdk': '^1.31.0' } },
      'packages/mcp-broker': { version: '0.1.0', dependencies: { '@sentropic/mcp-platform': '^0.3.1' } },
      'node_modules/@modelcontextprotocol/sdk': { version: '1.32.1', resolved: 'https://registry.npmjs.org/sdk-1.32.1.tgz', integrity: 'sha512-sdk==' },
      'node_modules/typescript': { version: '5.4.5', resolved: 'https://registry.npmjs.org/typescript-5.4.5.tgz', integrity: 'sha512-ts==' },
      'packages/mcp-platform/node_modules/@types/node': { version: '22.20.1', resolved: 'https://registry.npmjs.org/node-22.20.1.tgz', integrity: 'sha512-node==' },
      'packages/mcp-broker/node_modules/@types/node': { version: '22.20.1', resolved: 'https://registry.npmjs.org/node-22.20.1.tgz', integrity: 'sha512-node==' },
    },
  };
}

describe('lock-fingerprint — versioned P1 dependency and build-tool closure', () => {
  it('exposes a versioned fingerprint over the default build inputs', () => {
    expect(LOCK_FINGERPRINT_VERSION).toBe(1);
    expect(P1_BUILD_INPUTS).toEqual({ sdkRange: '^1.31.0', typescript: '5.4.5' });
    const digest = computeLockFingerprint(syntheticLock());
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(computeLockFingerprint(syntheticLock())).toBe(digest);
  });

  it('ignores unrelated lockfile edits', () => {
    const base = computeLockFingerprint(syntheticLock());
    const unrelated = syntheticLock();
    unrelated.packages['node_modules/some-unrelated-pkg'] = { version: '9.9.9', resolved: 'https://registry.npmjs.org/u-9.9.9.tgz', integrity: 'sha512-u==' };
    unrelated.packages['node_modules/better-sqlite3'] = { version: '12.0.0', resolved: 'https://registry.npmjs.org/b-12.0.0.tgz', integrity: 'sha512-b==' };
    expect(computeLockFingerprint(unrelated)).toBe(base);
    const churned = JSON.parse(JSON.stringify(syntheticLock()));
    churned.packages['node_modules/some-unrelated-pkg'] = { version: '9.9.10', resolved: 'https://registry.npmjs.org/u-9.9.10.tgz', integrity: 'sha512-u2==' };
    expect(computeLockFingerprint(churned)).toBe(base);
  });

  it.each([
    ['typescript version', (l) => { l.packages['node_modules/typescript'].version = '5.5.0'; }],
    ['typescript integrity', (l) => { l.packages['node_modules/typescript'].integrity = 'sha512-changed=='; }],
    ['sdk version', (l) => { l.packages['node_modules/@modelcontextprotocol/sdk'].version = '1.33.0'; }],
    ['platform version', (l) => { l.packages['packages/mcp-platform'].version = '0.3.2'; }],
    ['platform sdk range', (l) => { l.packages['packages/mcp-platform'].dependencies['@modelcontextprotocol/sdk'] = '^1.32.0'; }],
    ['broker platform range', (l) => { l.packages['packages/mcp-broker'].dependencies['@sentropic/mcp-platform'] = '^0.4.0'; }],
    ['platform @types/node', (l) => { l.packages['packages/mcp-platform/node_modules/@types/node'].version = '22.21.0'; }],
    ['removed sdk entry', (l) => { delete l.packages['node_modules/@modelcontextprotocol/sdk']; }],
  ])('changes the fingerprint on relevant edit: %s', (_, mutate) => {
    const lock = syntheticLock();
    mutate(lock);
    expect(computeLockFingerprint(lock)).not.toBe(computeLockFingerprint(syntheticLock()));
  });

  it('changes the fingerprint when build inputs change', () => {
    expect(computeLockFingerprint(syntheticLock(), { ...P1_BUILD_INPUTS, typescript: '5.5.0' })).not.toBe(computeLockFingerprint(syntheticLock()));
  });

  it('accepts the packed gate after an unrelated lockfile edit', () => {
    const f = p1Fixture();
    try {
      const lock = JSON.parse(readFileSync(`${f.root}/package-lock.json`, 'utf8'));
      lock.packages['node_modules/some-unrelated-pkg'] = { version: '9.9.9', resolved: 'https://registry.npmjs.org/u.tgz', integrity: 'sha512-u==' };
      f.put('package-lock.json', JSON.stringify(lock));
      const r = scan(f.root);
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it.each([
    ['typescript version', (l) => { l.packages['node_modules/typescript'].version = '5.5.0'; }],
    ['sdk integrity', (l) => { l.packages['node_modules/@modelcontextprotocol/sdk'].integrity = 'sha512-changed=='; }],
    ['platform version', (l) => { l.packages['packages/mcp-platform'].version = '0.9.9'; }],
  ])('refuses the packed gate on relevant lockfile edit: %s', (_, mutate) => {
    const f = p1Fixture();
    try {
      const lock = JSON.parse(readFileSync(`${f.root}/package-lock.json`, 'utf8'));
      mutate(lock);
      f.put('package-lock.json', JSON.stringify(lock));
      const r = scan(f.root);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/lock fingerprint mismatch/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});
