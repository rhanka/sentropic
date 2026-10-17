/**
 * L-5a — canonical manifest codec (spec-v8 §9).
 *
 * Deterministic serialization for content-addressed manifests: key sorting
 * is recursive, `undefined` object properties are omitted, and the digest is
 * the SHA-256 of the canonical UTF-8 bytes. `parseManifest` validates the
 * schema version and digest fail-closed.
 */
import { createHash } from 'node:crypto';
import { assertKnownSchemaVersion, type CanonicalManifest } from './contracts.js';

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue | undefined;
}

/**
 * Recursively sort object keys and drop `undefined` properties. Arrays are
 * treated as unordered sets: items are canonicalized first, then sorted by
 * their canonical bytes. Rationale: a manifest lists addressed files — the
 * file order carries no semantics, while the file set does.
 */
function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value
      .map(canonicalize)
      .sort((a, b) => {
        const sa = JSON.stringify(a);
        const sb = JSON.stringify(b);
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      });
  }
  if (typeof value === 'object' && value !== null) {
    const out: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as JsonObject)[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/** Deterministic serialization of a manifest (recursive key sort, no `undefined`). */
export function canonicalManifest(manifest: CanonicalManifest): string {
  return JSON.stringify(canonicalize(manifest as unknown as JsonObject));
}

/** SHA-256 hex digest of the canonical manifest bytes. */
export function manifestDigest(manifest: CanonicalManifest): string {
  return createHash('sha256').update(canonicalManifest(manifest), 'utf8').digest('hex');
}

/**
 * Parse and validate a manifest, fail-closed: JSON object, known schema
 * version, required `artifactId`. A present `digest` must match the body
 * recomputed without it; an absent digest means unsealed working document
 * (construction precedes sealing) and is accepted as-is.
 */
export function parseManifest(raw: string): CanonicalManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('invalid manifest: cannot parse body as JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('invalid manifest: not an object');
  }
  const manifest = parsed as CanonicalManifest;
  assertKnownSchemaVersion(manifest.schemaVersion);
  if (typeof manifest.artifactId !== 'string' || manifest.artifactId.length === 0) {
    throw new Error('invalid manifest: missing artifactId');
  }
  if (manifest.digest !== undefined) {
    const { digest: _drop, ...body } = manifest as CanonicalManifest & Record<string, unknown>;
    void _drop;
    const expected = manifestDigest(body as CanonicalManifest);
    if (manifest.digest !== expected) {
      throw new Error(`invalid manifest: digest mismatch (expected ${expected})`);
    }
  }
  return manifest;
}
