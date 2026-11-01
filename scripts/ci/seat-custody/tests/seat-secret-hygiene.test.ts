import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { artifactDigest, assertNamesOnly, sanitizeArtifactManifest, sealArtifact } from '../src/seat-ci-artifacts.ts';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pub = { keyId: '', pem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
pub.keyId = createHash('sha256').update(pub.pem).digest('hex').slice(0, 32);

test('T5-C3: public workflow logs/artifacts/caches are names-only — no canary, no plaintext, no private digests', () => {
  const secretValues = ['super-secret-canary-value', 'reader-token-epoch-2', 'synthetic-canonical-codex-00'];
  const privateDigests = ['a'.repeat(64), 'b'.repeat(64)];
  const envelope = sealArtifact(pub, 'SEAT_USE_CODEX_00', 'receipt', secretValues[2]);
  const manifest = sanitizeArtifactManifest([{ name: envelope.name, kind: envelope.kind, envelopeDigest: artifactDigest(envelope) }]);
  const log = `step Load SEAT_USE_CODEX_00\nuploaded ${envelope.name} (${envelope.kind})\n${manifest}\ncache-key: artifacts/2719\n`;
  assertNamesOnly(log, secretValues, privateDigests);
  assert.ok(log.includes('SEAT_USE_CODEX_00'), 'names remain visible');
  assert.throws(() => assertNamesOnly(log + secretValues[0], secretValues, privateDigests), /plaintext-leak/);
  assert.throws(() => assertNamesOnly(log + secretValues[1], secretValues, privateDigests), /plaintext-leak/);
  assert.throws(() => assertNamesOnly(log + privateDigests[0], secretValues, privateDigests), /private-digest-leak/);
});
