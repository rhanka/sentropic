import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { artifactDigest, openArtifact, sanitizeArtifactManifest, sealArtifact } from '../src/seat-ci-artifacts.ts';
import { settleUsage, type PaidDebit } from '../src/ci-credit-broker.ts';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pub = { keyId: '', pem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
pub.keyId = createHash('sha256').update(pub.pem).digest('hex').slice(0, 32);
const privPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const otherPriv = other.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

test('T5-C3: artifact retrieval yields only admitted ciphertext; wrong recipient and altered segments refuse', () => {
  const envelope = sealArtifact(pub, 'SECURITY_REPORT_DAILY', 'report', 'ciphertext-payload');
  const raw = JSON.stringify(envelope);
  assert.ok(!raw.includes('ciphertext-payload'), 'artifact bytes are ciphertext only');
  assert.equal(openArtifact(privPem, envelope), 'ciphertext-payload');
  // wrong recipient cannot open
  assert.throws(() => openArtifact(otherPriv, envelope), /key|decrypt/);
  // altered segment (tampered ciphertext) refuses on digest
  const altered = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -4) + 'AAAA' };
  assert.throws(() => openArtifact(privPem, altered), /digest|decrypt/);
  // lost envelope (missing artifact) refuses manifest read
  const manifest = JSON.parse(sanitizeArtifactManifest([{ name: envelope.name, kind: envelope.kind, envelopeDigest: artifactDigest(envelope) }]));
  assert.equal(manifest.artifacts.length, 1);
  assert.ok(!('ciphertext' in manifest.artifacts[0]));
  assert.throws(() => sanitizeArtifactManifest([{ name: 'lower-name', kind: 'report', envelopeDigest: '0'.repeat(64) }]), /manifest-entry/);
});

test('T5-C3: duplicate settlement cannot refund twice', () => {
  const debit: PaidDebit = { id: 'd1', reserved: 100, inputBound: 1000, outputBound: 1000, settled: false };
  const first = settleUsage(debit, { trusted: true, complete: true, id: 'd1', input: 10, output: 5 }, { input: 1, output: 1 });
  assert.equal(first.actual, 15);
  assert.equal(first.released, 85);
  assert.throws(() => settleUsage(debit, { trusted: true, complete: true, id: 'd1', input: 10, output: 5 }, { input: 1, output: 1 }), /already-settled/);
  const uncertain = settleUsage({ id: 'd2', reserved: 100, inputBound: 1000, outputBound: 1000, settled: false }, undefined, { input: 1, output: 1 });
  assert.equal(uncertain.actual, undefined);
  assert.equal(uncertain.held, 100, 'uncertain read never defaults to zero');
});
