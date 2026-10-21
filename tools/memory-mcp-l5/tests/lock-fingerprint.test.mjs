import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { LOCK_FINGERPRINT_VERSION, computeLockFingerprint } from '../lock-fingerprint.mjs';
import { parseToolchainSpecs, hashConfigFiles, P1_PRODUCING_TARGETS } from '../build-inputs.mjs';
import { p1Fixture } from './p1-fixture.mjs';

const scan = root => spawnSync(process.execPath, ['tools/memory-mcp-l5/import-graph.mjs', '--mode', 'packed', '--root', root, '--manifest', 'manifest.json'], { encoding: 'utf8' });

const REAL_MAKEFILE = readFileSync('Makefile', 'utf8');
const REAL_LOCK = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const REAL_TOOLCHAIN_LOCKS = {
  lock: JSON.parse(readFileSync('tools/memory-mcp-l5/artifacts/toolchain/toolchain.package-lock.json', 'utf8')),
  pkg: JSON.parse(readFileSync('tools/memory-mcp-l5/artifacts/toolchain/toolchain.package.json', 'utf8')),
};
const REAL_CONFIGS = {
  'packages/mcp-platform/tsconfig.json': readFileSync('packages/mcp-platform/tsconfig.json'),
  'packages/mcp-broker/tsconfig.json': readFileSync('packages/mcp-broker/tsconfig.json'),
};
const fingerprint = (lockDoc = REAL_LOCK, makefileText = REAL_MAKEFILE, configFiles = REAL_CONFIGS, toolchainLocks = REAL_TOOLCHAIN_LOCKS) =>
  computeLockFingerprint({ lockDoc, makefileText, configFiles, toolchainLocks });

const mutatedToolchainLocks = (mut) => {
  const clone = JSON.parse(JSON.stringify(REAL_TOOLCHAIN_LOCKS));
  mut(clone);
  return clone;
};

const TSC_ANCHOR = '"$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json; "$$tool_dir/node_modules/.bin/api-extractor" run';
const withTscFlag = (text) => text.replace(TSC_ANCHOR,
  '"$$tool_dir/node_modules/.bin/tsc" --removeComments -p tsconfig.json; "$$tool_dir/node_modules/.bin/api-extractor" run');

function replaceInTargetBlock(makefileText, target, search, replacement) {
  const start = makefileText.indexOf(`${target}:`);
  const end = makefileText.indexOf('\n\n', start);
  const block = makefileText.slice(start, end < 0 ? undefined : end);
  return makefileText.slice(0, start) + block.replace(search, replacement) + makefileText.slice(end < 0 ? makefileText.length : end);
}
const withImageSwap = (text) =>
  replaceInTargetBlock(text, 'api-extract-mcp-platform', '$(LLM_MESH_NODE_IMAGE)', 'node:22-bookworm-slim');

function gated(mut) {
  const f = p1Fixture();
  try {
    const lock = JSON.parse(readFileSync(`${f.root}/package-lock.json`, 'utf8'));
    mut(lock, f);
    f.put('package-lock.json', JSON.stringify(lock));
    return scan(f.root);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
}

describe('lock-fingerprint — derived P1 build inputs and provenance', () => {
  it('exposes fingerprint version 3 over the three producing targets', () => {
    expect(LOCK_FINGERPRINT_VERSION).toBe(3);
    expect(P1_PRODUCING_TARGETS).toEqual(['build-mcp-platform', 'build-mcp-broker', 'api-extract-mcp-platform']);
  });

  it('derives pinned toolchain specs and image from the real Makefile', () => {
    const toolchain = parseToolchainSpecs(REAL_MAKEFILE);
    expect(toolchain.image).toBe('node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6');
    expect(toolchain.targets['build-mcp-platform']).toContain('typescript@5.4.5');
    expect(toolchain.targets['build-mcp-platform']).toContain('@types/node@22.20.1');
    expect(toolchain.targets['api-extract-mcp-platform']).toContain('@microsoft/api-extractor@7.58.9');
  });

  it('binds emitting commands, effective image tokens, and llm-mesh image bindings', () => {
    const toolchain = parseToolchainSpecs(REAL_MAKEFILE);
    expect(toolchain.llmMeshDefault).toBe('node:24-bookworm-slim');
    expect(toolchain.llmMeshExport).toBe('$(MEMORY_L5_NODE_IMAGE)');
    for (const target of P1_PRODUCING_TARGETS) {
      expect(toolchain.images[target].length).toBeGreaterThan(0);
      for (const token of toolchain.images[target]) expect(token).toBe('$(LLM_MESH_NODE_IMAGE)');
      expect(toolchain.recipes[target].some((line) => line.includes('.bin/tsc'))).toBe(true);
    }
    expect(toolchain.recipes['api-extract-mcp-platform'].some((line) => line.includes('.bin/api-extractor'))).toBe(true);
  });

  it('changes the fingerprint on emitting-command and image-binding edits', () => {
    const base = fingerprint();
    expect(fingerprint(REAL_LOCK, withTscFlag(REAL_MAKEFILE))).not.toBe(base);
    expect(fingerprint(REAL_LOCK, REAL_MAKEFILE.replace(
      'export LLM_MESH_NODE_IMAGE = $(MEMORY_L5_NODE_IMAGE)',
      'export LLM_MESH_NODE_IMAGE = node:22-bookworm-slim'))).not.toBe(base);
    expect(fingerprint(REAL_LOCK, REAL_MAKEFILE.replace(
      'export LLM_MESH_NODE_IMAGE ?= node:24-bookworm-slim',
      'export LLM_MESH_NODE_IMAGE ?= node:22-bookworm-slim'))).not.toBe(base);
  });

  it('fails closed on an unmodelled effective-image token instead of passing', () => {
    expect(() => fingerprint(REAL_LOCK, withImageSwap(REAL_MAKEFILE))).toThrow(/unknown build image/);
  });

  it('fingerprints the installed toolchain records, not the workspace resolutions', () => {
    const closure = REAL_TOOLCHAIN_LOCKS.lock.packages;
    expect(closure['node_modules/@microsoft/api-extractor'].version).toBe('7.58.9');
    expect(closure['node_modules/@microsoft/api-extractor-model'].version).toBe('7.33.8');
    expect(closure['node_modules/@rushstack/node-core-library'].version).toBe('5.23.1');
    expect(REAL_LOCK.packages['node_modules/@microsoft/api-extractor'].version).not.toBe('7.58.9');
  });

  it('changes the fingerprint on installed-toolchain transitive change and edge deletion', () => {
    const base = fingerprint();
    expect(fingerprint(REAL_LOCK, REAL_MAKEFILE, REAL_CONFIGS, mutatedToolchainLocks((t) => {
      t.lock.packages['node_modules/fs-extra'].integrity = 'sha512-review';
    }))).not.toBe(base);
    expect(fingerprint(REAL_LOCK, REAL_MAKEFILE, REAL_CONFIGS, mutatedToolchainLocks((t) => {
      delete t.lock.packages['node_modules/@rushstack/node-core-library'].dependencies['fs-extra'];
    }))).not.toBe(base);
  });

  it('fails closed when the snapshot no longer satisfies the declared specs', () => {
    expect(() => fingerprint(REAL_LOCK, REAL_MAKEFILE, REAL_CONFIGS, mutatedToolchainLocks((t) => {
      delete t.pkg.dependencies.typescript;
    }))).toThrow(/does not satisfy/);
    expect(() => fingerprint(REAL_LOCK, REAL_MAKEFILE, REAL_CONFIGS, mutatedToolchainLocks((t) => {
      t.pkg.dependencies.typescript = '5.5.4';
    }))).toThrow(/does not satisfy/);
  });

  it.each([
    ['unpinned spec', 'MEMORY_L5_TOOLCHAIN := typescript@5.4.5 @types/node'],
    ['missing declaration', 'build-mcp-platform:\n\tdocker run --rm $(LLM_MESH_NODE_IMAGE) sh -lc \'x\''],
    ['unknown image token', 'MEMORY_L5_TOOLCHAIN := typescript@5.4.5\nbuild-mcp-platform:\n\tdocker run --rm node:22-bookworm-slim sh -lc \'x\''],
  ])('fails closed on %s', (_, block) => {
    expect(() => parseToolchainSpecs(`MEMORY_L5_NODE_IMAGE := img\nexport LLM_MESH_NODE_IMAGE ?= node:24-bookworm-slim\nmemory-l5-pack: export LLM_MESH_NODE_IMAGE = $(MEMORY_L5_NODE_IMAGE)\n${block}`)).toThrow(/build inputs/);
  });

  it.each([
    ['llm-mesh export binding', REAL_MAKEFILE.replace('export LLM_MESH_NODE_IMAGE = $(MEMORY_L5_NODE_IMAGE)', '')],
    ['llm-mesh default binding', REAL_MAKEFILE.replace('export LLM_MESH_NODE_IMAGE ?= node:24-bookworm-slim\n', '')],
  ])('fails closed on missing %s', (_, text) => {
    expect(() => parseToolchainSpecs(text)).toThrow(/build inputs/);
  });

  it('changes the fingerprint on real build-input change and ignores unrelated lock edits', () => {
    const base = fingerprint();
    expect(fingerprint()).toBe(base);
    expect(hashConfigFiles({ b: 'x', a: 'y' })).toEqual(hashConfigFiles({ a: 'y', b: 'x' }));
    const unrelated = JSON.parse(JSON.stringify(REAL_LOCK));
    unrelated.packages['node_modules/some-unrelated-pkg'] = { version: '9.9.9', resolved: 'https://r/u.tgz', integrity: 'sha512-u==' };
    expect(fingerprint(unrelated)).toBe(base);
    expect(() => fingerprint(REAL_LOCK, REAL_MAKEFILE.replace(
      'MEMORY_L5_TOOLCHAIN := typescript@5.4.5',
      'MEMORY_L5_TOOLCHAIN := typescript@5.5.4'))).toThrow(/does not satisfy/);
    expect(() => fingerprint(REAL_LOCK, REAL_MAKEFILE.replace(
      '@microsoft/api-extractor@7.58.9',
      '@microsoft/api-extractor@7.58.10'))).toThrow(/does not satisfy/);
    expect(fingerprint(REAL_LOCK, REAL_MAKEFILE, {
      ...REAL_CONFIGS, 'packages/mcp-platform/tsconfig.json': Buffer.from('{"compilerOptions":{"target":"ES2023"}}'),
    })).not.toBe(base);
  });

  it('accepts the packed gate after an unrelated live-lock edit', () => {
    const r = gated((lock) => { lock.packages['node_modules/some-unrelated-pkg'] = { version: '9.9.9', resolved: 'https://r/u.tgz', integrity: 'sha512-u==' }; });
    expect(r.status).toBe(0);
  });

  it.each([
    ['tsconfig target change', (lock, f) => { f.put('packages/mcp-platform/tsconfig.json', readFileSync(`${f.root}/packages/mcp-platform/tsconfig.json`, 'utf8').replace('ES2022', 'ES2023')); }],
    ['emitting tsc flag change', (lock, f) => { f.put('Makefile', withTscFlag(readFileSync(`${f.root}/Makefile`, 'utf8'))); }],
  ])('refuses the packed gate on %s', (_, mut) => {
    const r = gated(mut);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/lock fingerprint mismatch/);
  });

  it('refuses the packed gate on a stale toolchain snapshot after a compiler pin change', () => {
    const r = gated((lock, f) => { f.put('Makefile', readFileSync(`${f.root}/Makefile`, 'utf8').replace(
      'MEMORY_L5_TOOLCHAIN := typescript@5.4.5', 'MEMORY_L5_TOOLCHAIN := typescript@5.5.4')); });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/does not satisfy/);
  });

  it.each([
    ['installed-toolchain transitive drift', (snap) => { snap.packages['node_modules/fs-extra'].integrity = 'sha512-review'; }],
    ['installed-toolchain edge deletion', (snap) => { delete snap.packages['node_modules/@rushstack/node-core-library'].dependencies['fs-extra']; }],
  ])('refuses the packed gate on %s', (_, mutateSnap) => {
    const r = gated((lock, f) => {
      const rel = 'tools/memory-mcp-l5/artifacts/toolchain/toolchain.package-lock.json';
      const snap = JSON.parse(readFileSync(`${f.root}/${rel}`, 'utf8'));
      mutateSnap(snap);
      f.put(rel, JSON.stringify(snap));
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/lock fingerprint mismatch/);
  });

  it('refuses the packed gate when the snapshot package no longer satisfies the specs', () => {
    const r = gated((lock, f) => {
      const rel = 'tools/memory-mcp-l5/artifacts/toolchain/toolchain.package.json';
      const pkg = JSON.parse(readFileSync(`${f.root}/${rel}`, 'utf8'));
      pkg.dependencies.typescript = '5.5.4';
      f.put(rel, JSON.stringify(pkg));
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/does not satisfy/);
  });

  it('refuses the packed gate on an unmodelled effective image token', () => {
    const r = gated((lock, f) => { f.put('Makefile', withImageSwap(readFileSync(`${f.root}/Makefile`, 'utf8'))); });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/unknown build image/);
  });

  it.each([
    ['missing provenance snapshot', (lock, f) => { rmSync(join(f.root, f.manifest.source.declaredLockSnapshot.path)); }],
    ['corrupt provenance snapshot', (lock, f) => { f.put(f.manifest.source.declaredLockSnapshot.path, 'corrupt'); }],
    ['zeroed generation hash', (lock, f) => { f.manifest.source.declaredLockSha256 = '0'.repeat(64); f.save(); }],
  ])('refuses the packed gate on %s while unrelated live edits still pass', (_, mut) => {
    const r = gated(mut);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/provenance snapshot/);
  });
});
