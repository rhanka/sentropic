// r6 §4.3.1/T5-C3: the qualified encrypted artifact path carries ciphertext only.
// Public retrieval yields admitted sealed envelopes; names-only manifests never leak
// plaintext values or private digests.
import { createHash } from 'node:crypto';
import { ensure } from './seat-admission.ts';
import { openSealed, sealSecret, type SealedEnvelope } from './seat-environment-custody.ts';

export type ArtifactEnvelope = SealedEnvelope & { name: string; kind: string };

export function sealArtifact(publicKey: { keyId: string; pem: string }, name: string, kind: string, payload: string): ArtifactEnvelope {
  ensure(/^[A-Z0-9_]+$/.test(name), 'artifact-name');
  ensure(['report', 'receipt', 'log-bundle'].includes(kind), 'artifact-kind');
  return { ...sealSecret(publicKey, payload), name, kind };
}

export function openArtifact(privatePem: string, envelope: ArtifactEnvelope): string {
  ensure(/^[A-Z0-9_]+$/.test(envelope.name), 'artifact-name');
  return openSealed(privatePem, envelope);
}

export type ArtifactManifestEntry = { name: string; kind: string; envelopeDigest: string };

// Names plus opaque envelope digests only: no plaintext, no private state digests.
export function sanitizeArtifactManifest(entries: ArtifactManifestEntry[]): string {
  for (const e of entries) {
    ensure(/^[A-Z0-9_]+$/.test(e.name) && /^[0-9a-f]{64}$/.test(e.envelopeDigest), 'manifest-entry');
  }
  return JSON.stringify({ version: 1, artifacts: entries.map(e => ({ name: e.name, kind: e.kind, envelopeDigest: e.envelopeDigest })) });
}

export function assertNamesOnly(text: string, secretValues: string[], privateDigests: string[] = []): void {
  for (const value of secretValues) ensure(!text.includes(value), 'plaintext-leak');
  for (const digest of privateDigests) ensure(!text.includes(digest), 'private-digest-leak');
}

export const artifactDigest = (envelope: ArtifactEnvelope): string =>
  createHash('sha256').update(`${envelope.name}.${envelope.kind}.${envelope.digest}`).digest('hex');
