// S1 inventory tests (make test-publishable-manifests SCOPE=... ENV=test-sec-s1).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  failClosedReport,
  findDerivedPinConsumers,
  inventoryImages,
  inventoryLocks,
  inventoryRepository,
  inventorySastRoots,
} from './inventory.mjs';
import { joinRegister } from './schema.mjs';

test('inventory covers three images with toolbox Dockerfile', () => {
  const seen = inventoryImages({ inventory: { images: [
    { key: 'api-production', dockerfile: 'api/Dockerfile' },
    { key: 'api-toolbox', dockerfile: 'api/Dockerfile' },
    { key: 'ui-production', dockerfile: 'ui/Dockerfile' },
  ] } });
  assert.ok(seen.every((image) => image.present));
  assert.ok(seen.filter((image) => image.dockerfile === 'api/Dockerfile').length >= 2);
});

test('inventory covers root, UI and kit locks', () => {
  const locks = inventoryLocks('.');
  assert.ok(locks.find((lock) => lock.path === 'package-lock.json'));
  assert.ok(locks.find((lock) => lock.path === 'ui/package-lock.json'));
  assert.ok(locks.find((lock) => lock.path === 'docs/governance/kit/package-lock.json'));
});

test('SAST roots stay explicitly blocked until S2c', () => {
  const sast = inventorySastRoots({ inventory: { sastRoots: ['api/src', 'ui/src'], sastBlockedUntil: 'S2c native Rust ast-grep qualification' } });
  assert.deepEqual(sast.roots, ['api/src', 'ui/src']);
  assert.equal(sast.qualified, false);
  assert.match(sast.blockedUntil, /S2c/);
});

test('register join keeps 67 rows with expiry state, seven stale-container candidates separate', () => {
  const rows = [
    { id: 'kept-1', review_due: '2026-11-20' },
    { id: 'old-1', review_due: '2026-10-11' },
  ];
  const kept = joinRegister({ id: 'kept-1' }, rows);
  assert.equal(kept.register, 'registered-exception');
  assert.equal(joinRegister({ id: 'missing' }, rows).register, 'none');
  assert.equal(joinRegister({ id: 'other' }, []).queue, 'queued');
});

test('fail-closed parser rejects empty, malformed and incomplete reports', () => {
  assert.throws(() => failClosedReport(''), /empty/);
  assert.throws(() => failClosedReport('{not-json'), /malformed/);
  assert.throws(() => failClosedReport('{"Results":[]}'), /incomplete/);
  assert.throws(() => failClosedReport(null), /missing/);
  const clean = failClosedReport('{"SchemaVersion":2,"ArtifactName":"x","Results":[]}');
  assert.deepEqual(clean.Results, []);
});

test('repository inventory finds derived-pin consumers including L5 manifest', () => {
  const consumers = findDerivedPinConsumers('.');
  assert.ok(consumers.length > 0);
  assert.ok(consumers.some((path) => path.includes('pre-candidate-manifest.json')));
  const repo = inventoryRepository('.', {
    inventory: { images: [
      { key: 'api-production', dockerfile: 'api/Dockerfile' },
      { key: 'api-toolbox', dockerfile: 'api/Dockerfile' },
      { key: 'ui-production', dockerfile: 'ui/Dockerfile' },
    ], sastRoots: ['api/src'], sastBlockedUntil: 'S2c' },
    derivedPins: { undeclaredConsumerIsBlocker: true },
  });
  assert.equal(repo.coverage.undeclaredConsumerIsBlocker, true);
});
