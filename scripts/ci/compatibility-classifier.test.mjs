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
