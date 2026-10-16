/**
 * L-5a — canonical manifests: equivalent manifests in different field/file
 * orders serialize to identical bytes and digests; any semantic change
 * alters the digest. Server identities, timestamps and retry keys never
 * leak into the canonical form.
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalManifest,
  manifestDigest,
  parseManifest,
} from '../src/codecs.js';

const BASE = {
  schemaVersion: 'artifacts/v1',
  artifactId: '11111111-1111-4111-8111-111111111111',
  storageScopeId: 'scope-1',
  ownerId: 'owner-1',
  profile: { title: 'Hello', theme: 'light' },
  provenance: { source: 'inline-original' },
  files: [
    { path: 'b.html', digest: 'sha256:bbbb', size: 2, mimeType: 'text/html' },
    { path: 'a.html', digest: 'sha256:aaaa', size: 1, mimeType: 'text/html' },
  ],
};

describe('canonical manifests', () => {
  it('serializes equivalent field orders to identical bytes', () => {
    const reordered = {
      files: [...BASE.files].reverse(),
      ownerId: BASE.ownerId,
      provenance: { ...BASE.provenance },
      profile: { theme: 'light', title: 'Hello' },
      storageScopeId: BASE.storageScopeId,
      artifactId: BASE.artifactId,
      schemaVersion: BASE.schemaVersion,
    };
    expect(canonicalManifest(reordered)).toBe(canonicalManifest(BASE));
    expect(manifestDigest(reordered)).toBe(manifestDigest(BASE));
  });

  it('changes the digest on any semantic change', () => {
    const otherProfile = { ...BASE, profile: { title: 'Other', theme: 'light' } };
    const otherFile = {
      ...BASE,
      files: [{ path: 'a.html', digest: 'sha256:zzzz', size: 1, mimeType: 'text/html' }],
    };
    expect(manifestDigest(otherProfile)).not.toBe(manifestDigest(BASE));
    expect(manifestDigest(otherFile)).not.toBe(manifestDigest(BASE));
    expect(manifestDigest(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('parses canonical bytes back and refuses unknown schemas', () => {
    expect(parseManifest(canonicalManifest(BASE))).toEqual(BASE);
    expect(() => parseManifest('{"schemaVersion":"artifacts/v9"}')).toThrow(/unknown artifact schema/);
    expect(() => parseManifest('{oops')).toThrow(/parse/);
    expect(() => parseManifest('{"schemaVersion":"artifacts/v1"}')).toThrow(/artifactId/);
  });
});
