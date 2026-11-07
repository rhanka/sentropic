import test from 'node:test';
import assert from 'node:assert/strict';
import { manifestLabels, validateManifest, pinnedRef, TAG } from './api-tool-registry.mjs';

const hash = `sha256:${'a'.repeat(64)}`;
const tag = `tool-${'b'.repeat(64)}`;
const expected = { schema: '1', tag, lockDigest: hash, architecture: 'linux/amd64' };
const labels = manifestLabels({ ...expected, imageId: hash });

test('should accept only a manifest matching the full content identity', () => {
  assert.equal(validateManifest(labels, expected), labels);
  for (const key of Object.keys(expected)) assert.throws(() => validateManifest({ ...labels, [key]: 'other' }, expected), /mismatch/);
  assert.throws(() => validateManifest({ ...labels, imageId: 'bad' }, expected), /Invalid/);
});

test('should only accept complete content-addressed tags', () => {
  assert.ok(TAG.test(tag));
  for (const bad of ['latest', 'tool-abc', `tool-${'b'.repeat(64)}-manifest`]) assert.ok(!TAG.test(bad));
});

test('should accept the dependency-only tag family and reject lookalikes', () => {
  assert.ok(TAG.test(`tooldeps-${'c'.repeat(64)}`));
  for (const bad of ['tooldeps-abc', `tooldeps-${'c'.repeat(64)}-manifest`, `tool deps-${'c'.repeat(64)}`]) assert.ok(!TAG.test(bad));
});

test('should pin a pulled image to the repository manifest digest only', () => {
  const repo = 'ghcr.io/rhanka/sentropic-ci-toolbox-deps';
  const digestRef = `${repo}@sha256:${'d'.repeat(64)}`;
  assert.equal(pinnedRef(repo, ['ghcr.io/other/x@sha256:' + 'e'.repeat(64), digestRef]), digestRef);
  assert.throws(() => pinnedRef(repo, []), /no digest/);
  assert.throws(() => pinnedRef(repo, [`${repo}@sha256:short`]), /no digest/);
});
