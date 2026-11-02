import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../daily/toolchain-contract.mjs';
import { applyOrderedPatches } from './material-patches.mjs';

function patch(path, before, after, editBefore = before, editAfter = after) {
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, files: [{ path,
    beforeDigest: digest(before), afterDigest: digest(after),
    edits: [{ before: editBefore, after: editAfter }] }] }));
  return { bytes, digest: digest(bytes) };
}

const vulnerable = 'module fixture\nrequire github.com/go-jose/go-jose/v4 v4.1.5\n';
const fixed = vulnerable.replace('v4.1.5', 'v4.1.6');
function fixture() {
  return { source: { 'go.mod': Buffer.from(vulnerable), LICENSE: Buffer.from('license'),
    Dockerfile: Buffer.from('brotli-libs=1.2.0-r1 libcurl=8.22.0-r0') },
  patches: [
    patch('Dockerfile', 'brotli-libs=1.2.0-r1 libcurl=8.22.0-r0', 'brotli-libs=1.2.1-r0 libcurl=8.22.0-r0'),
    patch('Dockerfile', 'brotli-libs=1.2.1-r0 libcurl=8.22.0-r0', 'brotli-libs=1.2.1-r0 libcurl=8.23.0-r0'),
    patch('go.mod', vulnerable, fixed, 'v4.1.5', 'v4.1.6'),
  ] };
}

test('should apply only the ordered hash-bound patches while preserving source and licenses', () => {
  const f = fixture();
  const result = applyOrderedPatches(f.source, f.patches);
  assert.equal(result['go.mod'].toString(), fixed);
  assert.equal(result.Dockerfile.toString(), 'brotli-libs=1.2.1-r0 libcurl=8.23.0-r0');
  assert.equal(result.LICENSE.toString(), 'license');
  assert.equal(f.source['go.mod'].toString(), vulnerable);
  assert.notEqual(result['go.mod'], f.source['go.mod']);
});

test('should retain the embedded Go defect after applying only OS repairs', () => {
  const f = fixture();
  const result = applyOrderedPatches(f.source, f.patches.slice(0, 2));
  assert.equal(result.Dockerfile.toString(), 'brotli-libs=1.2.1-r0 libcurl=8.23.0-r0');
  assert.equal(result['go.mod'].toString(), vulnerable);
});

test('should refuse changed source, patch bytes, patch order and expected output checksums', () => {
  for (const mutate of [
    f => { f.source['go.mod'] = Buffer.from(`${vulnerable}changed\n`); },
    f => { f.patches[0].bytes = Buffer.from('{}'); },
    f => { f.patches.reverse(); },
    f => { delete f.source.Dockerfile; },
    f => { const p = JSON.parse(f.patches[0].bytes); p.files[0].afterDigest = digest('wrong');
      f.patches[0].bytes = Buffer.from(JSON.stringify(p)); f.patches[0].digest = digest(f.patches[0].bytes); },
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => applyOrderedPatches(f.source, f.patches), /scanner-contract/);
  }
});

test('should refuse ambiguous edits, undeclared fields, duplicate targets and escaping paths', () => {
  for (const mutate of [
    p => { p.extra = true; },
    p => { p.files[0].path = '../go.mod'; },
    p => { p.files[0].path = '/go.mod'; },
    p => { p.files[0].edits[0].before = ''; },
    p => { p.files[0].edits[0].before = 'absent'; },
    p => { p.files[0].edits[0].before = 'i'; },
    p => { p.files.push(structuredClone(p.files[0])); },
  ]) {
    const f = fixture(); const p = JSON.parse(f.patches[0].bytes); mutate(p);
    f.patches[0].bytes = Buffer.from(JSON.stringify(p)); f.patches[0].digest = digest(f.patches[0].bytes);
    assert.throws(() => applyOrderedPatches(f.source, f.patches), /scanner-contract/);
    assert.equal(f.source['go.mod'].toString(), vulnerable);
  }
});
