import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCandidateBundle } from '../bundle.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixture = () => {
  const bytes = Buffer.from('synthetic archive');
  return {
    manifest: {
      kind: 'candidate', image: { reference: 'node:24-bookworm-slim', digest: 'a'.repeat(64) }, pythonFree: true,
      sourceSha: 'a'.repeat(40), contractSha256: 'b'.repeat(64), releaseLockSha256: 'c'.repeat(64),
      artifacts: [{ path: 'artifacts/mesh.tgz', size: bytes.length, sha256: hash(bytes) }],
      packages: [{ lockLocation: 'node_modules/@sentropic/llm-mesh', name: '@sentropic/llm-mesh', version: '0.27.0', resolved: 'https://registry.npmjs.org/mesh.tgz', integrity: 'sha512-AA==', tarballSha256: hash(bytes), sourceIdentity: 'candidate:source' }],
      profiles: ['gateway-messaging', 'gateway-runtime'],
      programCoverage: [{ program: 'gateway', phase: 'pr1-candidate', contractSha256: 'b'.repeat(64), profiles: ['gateway-messaging', 'gateway-runtime'] }],
    }, files: new Map([['artifacts/mesh.tgz', bytes]]),
  };
};
it('constructs all seven delivery bundles with exact index bytes', () => {
  for (const [program, deliveries] of [['gateway', ['pr1', 'pr2', 'pr3']], ['registry', ['r4', 'r5', 'r6', 'r7b']]]) {
    for (const delivery of deliveries) {
      const f = fixture();
      f.manifest.programCoverage = [{ program, phase: `${delivery}-candidate`, contractSha256: f.manifest.contractSha256, profiles: f.manifest.profiles }];
      const result = createCandidateBundle({ ...f, program, delivery, mode: 'aggregate' });
      assert.equal(result.input.candidateBundle.bundleSha256, hash(result.files.get('bundle-index.json')));
      assert.equal(result.input.artifactManifest.sha256, hash(result.files.get('manifest.json')));
      assert.equal(result.input.phase, `${delivery}-candidate`);
      assert.ok(result.totalBytes > 0);
    }
  }
});
it('refuses wrong deliveries, altered, missing, extra and traversal inputs', () => {
  const f = fixture();
  const run = (overrides = {}) => createCandidateBundle({ ...f, program: 'gateway', delivery: 'pr1', mode: 'aggregate', ...overrides });
  assert.throws(() => run({ delivery: 'r4' }), { code: 'bad-phase' });
  assert.throws(() => run({ files: new Map() }), { code: 'bundle-mismatch' });
  assert.throws(() => run({ files: new Map([['artifacts/mesh.tgz', Buffer.from('changed')]]) }), { code: 'bundle-mismatch' });
  assert.throws(() => run({ files: new Map([...f.files, ['extra', Buffer.from('x')]]) }), { code: 'bundle-mismatch' });
  f.manifest.artifacts[0].path = '../escape';
  assert.throws(() => run(), { code: 'bad-path' });
});
