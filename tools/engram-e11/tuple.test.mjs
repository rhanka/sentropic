import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bindings, canonical, sha256, verifyTuple } from './bindings.mjs';
import { build, report } from './tuple.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'e11-test-'));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('should bind final newline and refuse changed referenced bytes', () => fixture((root) => {
  writeFileSync(join(root, 'input'), 'candidate\n');
  const b = bindings(root);
  b.read('input', sha256('candidate\n'));
  writeFileSync(join(root, 'input'), 'candidate');
  assert.throws(() => b.read('input', sha256('candidate\n')), /sha256 mismatch/);
}));

test('should refuse a missing referenced file', () => fixture((root) => {
  assert.throws(() => bindings(root).read('missing'), /ENOENT/);
}));

test('should refuse an external path and escaping symlink', () => fixture((root) => {
  const b = bindings(root);
  assert.throws(() => b.read('../external'), /unsafe path/);
  assert.throws(() => b.read('/etc/passwd'), /unsafe path/);
  symlinkSync('/etc/passwd', join(root, 'external'));
  assert.throws(() => b.read('external'), /outside evidence root/);
}));

test('should bind every file in a source tree', () => fixture((root) => {
  writeFileSync(join(root, 'a.ts'), 'source-a');
  writeFileSync(join(root, 'b.ts'), 'source-b');
  const b = bindings(root);
  assert.equal(Object.keys(b.tree('.')).length, 2);
  assert.equal(b.files['./a.ts'].sha256, sha256('source-a'));
}));

test('should produce identical bytes despite object insertion order', () => {
  assert.equal(canonical({ z: 1, a: { y: 2, b: 3 } }), canonical({ a: { b: 3, y: 2 }, z: 1 }));
});

test('should reject archive integrity substitution before opening archive members', () => fixture((root) => {
  writeFileSync(join(root, 'bad.tgz'), 'same file list does not establish archive identity');
  assert.throws(() => bindings(root).archive('bad.tgz', { sha256: sha256('same file list does not establish archive identity'),
    integrity: 'sha512-wrong' }), /integrity mismatch/);
}));

test('should refuse a pending tuple at the final acceptance gate', () => {
  const tuple = { format: 'e2-host-tuple/v1', status: 'PENDING' };
  assert.throws(() => verifyTuple(tuple, tuple, true), /PENDING preparation/);
});

test('should reject a changed tuple or manually promoted profile', () => {
  const tuple = { format: 'e2-host-tuple/v1', status: 'PENDING', profile: 'declared' };
  assert.throws(() => verifyTuple({ ...tuple, profile: 'qualified' }, tuple), /differs from recomputed/);
  assert.throws(() => verifyTuple({ ...tuple, status: 'FINAL' }, tuple, true), /differs from recomputed/);
});

test('should reproduce E2 bytes while refusing unqualified profiles and stable-release acceptance', () => {
  const first = build('/evidence');
  const second = build('/evidence');
  assert.equal(canonical(first), canonical(second));
  assert.equal(verifyTuple(first, second), report(first).tupleSha256);
  assert.equal(first.slots.length, 21);
  assert.equal(first.backend.sha256, first.files[first.backend.archive].sha256);
  assert.equal(first.neutralContract.path, 'neutral-contract-1.0.0.jcs.json');
  assert.equal(first.neutralContract.sha256, '55f8d4572db7100e4dba0a135331cdeb1186458711f0c7202e5f0cd93a6dc759');
  assert.equal(first.neutralContract.contractDigest, 'sha256:dd0cccbd6e5e29766fbc9c48351ffe58f5b0a3162152f5ff02da0798c3244fee');
  assert.equal(first.engram.version, '0.21.3');
  assert.equal(first.backend.version, '0.24.0-dev.6');
  assert.equal(first.neutralContract.version, '1.0.0');
  assert.deepEqual(first.profiles, []);
  assert.equal(first.requiredProfiles.length, 5);
  assert.match(first.nodeImage, /^node:24-bookworm-slim@sha256:[a-f0-9]{64}$/);
  assert(first.locks.every((lock) => first.files[lock.path].sha256 === lock.sha256));
  assert(first.slots.every((slot) => first.files[slot.file]));
  assert(first.slots.filter((slot) => slot.status === 'PENDING').every((slot) => slot.reason.length > 0));
  assert.equal(first.slots[14].observed.c6.finalBytesSha256, first.neutralContract.sha256);
  assert.equal(first.slots[14].observed.c6.standaloneDeclarationSha256, null);
  assert.deepEqual(first.slots.filter((s) => s.status === 'PENDING').map((s) => s.id), [15, 16]);
  assert.equal(first.slots[15].observed.equivalence.status, 'not-covered');
  assert(first.files['consumer/installed-hydration.mjs']);
  assert(Object.values(first.handoff).every((gate) => gate.status === 'PENDING'));
  fixture((root) => {
    const path = join(root, 'pending.json');
    writeFileSync(path, canonical(first));
    const receivingSource = readFileSync('/evidence/receiving-validator.mjs', 'utf8');
    const start = receivingSource.indexOf("const HOST_TUPLE_FORMAT = 'e2-host-tuple/v1';");
    const end = receivingSource.indexOf('function prepareE2(', start);
    assert(start >= 0 && end > start);
    const readHostTuple = runInNewContext(`${receivingSource.slice(start, end)}\nreadHostTuple;`, {
      assert, readFileSync, resolve: (file) => file,
    });
    assert.throws(() => readHostTuple(path), /source-gap: host tuple is incomplete.*backend closure.*profiles/s);
  });
});
