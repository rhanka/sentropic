// Compatibility classification fixtures (make test-ci-compatibility).
// Every library change kind maps to the consumer selection it requires:
// internal fix, additive, breaking, explicit adoption, root lock/toolchain,
// runtime/security, UI-only, and shared auth-ui assets. Unknown or missing
// evidence selects full blocking integration.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHANGE_KINDS,
  classifyCompatibility,
  classifyFileArea,
  classifyPackageChange,
} from './compatibility-classifier.mjs';

const lib = (slug, version, deps = {}) => ({ name: `@sentropic/${slug}`, version, dependencies: deps });
const app = (name, version, deps = {}) => ({ name, version, dependencies: deps });

test('should reject an empty or missing file list as unknown', () => {
  for (const files of [[], null, undefined, 'packages/comments/src/a.ts']) {
    const verdict = classifyCompatibility({ files, packages: [] });
    assert.equal(verdict.kind, 'unknown', JSON.stringify(files));
    assert.match(verdict.reasons.join('\n'), /file evidence/);
  }
});

test('should reject an unrecognized path as unknown', () => {
  const verdict = classifyCompatibility({ files: ['tools/secret-mystery/x.ts'], packages: [] });
  assert.equal(verdict.kind, 'unknown');
  assert.match(verdict.reasons.join('\n'), /tools\/secret-mystery\/x\.ts/);
});

test('should classify docs and test-only edits as internal fix', () => {
  const verdict = classifyCompatibility({
    files: ['packages/comments/tests/a.test.ts', 'packages/comments/README.md'],
    packages: [{ slug: 'comments', scope: 'library', published: lib('comments', '0.3.1'), candidate: lib('comments', '0.3.1') }],
  });
  assert.equal(verdict.kind, 'internal-fix');
  assert.match(verdict.reasons.join('\n'), /no functional change/);
});

test('should classify a patch bump with identical deps as internal fix', () => {
  const verdict = classifyPackageChange({
    slug: 'comments',
    scope: 'library',
    files: ['packages/comments/src/store.ts'],
    published: lib('comments', '0.3.1', { hono: '^4.10.7' }),
    candidate: lib('comments', '0.3.2', { hono: '^4.10.7' }),
  });
  assert.equal(verdict.kind, 'internal-fix');
});

test('should reject a changed source without a version bump as unknown', () => {
  const verdict = classifyPackageChange({
    slug: 'comments',
    scope: 'library',
    files: ['packages/comments/src/store.ts'],
    published: lib('comments', '0.3.1'),
    candidate: lib('comments', '0.3.1'),
  });
  assert.equal(verdict.kind, 'unknown');
  assert.match(verdict.reasons.join('\n'), /without version bump/);
});

test('should classify a minor bump as additive and a major bump as breaking', () => {
  const minor = classifyPackageChange({
    slug: 'comments', scope: 'library', files: ['packages/comments/src/a.ts', 'packages/comments/package.json'],
    published: lib('comments', '0.3.1'), candidate: lib('comments', '0.4.0'),
  });
  assert.equal(minor.kind, 'additive');
  const major = classifyPackageChange({
    slug: 'comments', scope: 'library', files: ['packages/comments/src/a.ts', 'packages/comments/package.json'],
    published: lib('comments', '0.3.1'), candidate: lib('comments', '1.0.0'),
  });
  assert.equal(major.kind, 'breaking');
  assert.match(major.reasons.join('\n'), /major/);
});

test('should classify a removed dependency or a tightened floor as breaking', () => {
  const removed = classifyPackageChange({
    slug: 'comments', scope: 'library', files: ['packages/comments/src/a.ts', 'packages/comments/package.json'],
    published: lib('comments', '0.3.1', { hono: '^4.10.7', zod: '^3.25.76' }),
    candidate: lib('comments', '0.3.2', { hono: '^4.10.7' }),
  });
  assert.equal(removed.kind, 'breaking');
  assert.match(removed.reasons.join('\n'), /removed dependency: zod/);
  const tightened = classifyPackageChange({
    slug: 'comments', scope: 'library', files: ['packages/comments/src/a.ts', 'packages/comments/package.json'],
    published: lib('comments', '0.3.1', { hono: '^4.10.7' }),
    candidate: lib('comments', '0.3.2', { hono: '^4.13.0' }),
  });
  assert.equal(tightened.kind, 'breaking');
  assert.match(tightened.reasons.join('\n'), /tightened floor/);
});

test('should classify an added dependency as additive', () => {
  const verdict = classifyPackageChange({
    slug: 'comments', scope: 'library', files: ['packages/comments/src/a.ts', 'packages/comments/package.json'],
    published: lib('comments', '0.3.1', { hono: '^4.10.7' }),
    candidate: lib('comments', '0.4.0', { hono: '^4.10.7', zod: '^3.25.76' }),
  });
  assert.equal(verdict.kind, 'additive');
  assert.match(verdict.reasons.join('\n'), /added dependency: zod/);
});

test('should reject a file: dependency value as unknown because workspaces resolve source', () => {
  const verdict = classifyPackageChange({
    slug: 'comments', scope: 'library', files: ['packages/comments/src/a.ts', 'packages/comments/package.json'],
    published: lib('comments', '0.3.1', {}),
    candidate: lib('comments', '0.3.2', { '@sentropic/contracts': 'file:../contracts' }),
  });
  assert.equal(verdict.kind, 'unknown');
  assert.match(verdict.reasons.join('\n'), /not registry evidence/);
});

test('should reject missing manifest evidence as unknown', () => {
  for (const entry of [
    { slug: 'comments', scope: 'library', files: ['packages/comments/src/a.ts'], published: null, candidate: lib('comments', '0.3.2') },
    { slug: 'comments', scope: 'library', files: ['packages/comments/src/a.ts'], published: lib('comments', '0.3.1'), candidate: null },
  ]) {
    assert.equal(classifyPackageChange(entry).kind, 'unknown', JSON.stringify(entry.published));
  }
});

test('should classify an application adopting a new library range as explicit adoption', () => {
  const verdict = classifyPackageChange({
    slug: 'api', scope: 'application', files: ['api/package.json'],
    published: app('api', '0.0.0', { '@sentropic/comments': 'file:../packages/comments' }),
    candidate: app('api', '0.0.0', { '@sentropic/comments': '0.4.0' }),
  });
  assert.equal(verdict.kind, 'explicit-adoption');
  assert.match(verdict.reasons.join('\n'), /adopts @sentropic\/comments/);
});
