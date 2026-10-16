/**
 * L-5a — artifact domain contracts: schema versions, identity allocation and
 * structural validation. Unknown schema versions are refused; identities are
 * server-allocated UUIDs, never client-selected.
 */
import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_SCHEMA_VERSIONS,
  assertKnownSchemaVersion,
  createArtifactId,
  isArtifactId,
  type ArtifactSchemaVersion,
} from '../src/contracts.js';

describe('artifact contracts', () => {
  it('knows exactly one schema version', () => {
    expect([...ARTIFACT_SCHEMA_VERSIONS]).toEqual(['artifacts/v1']);
    const version: ArtifactSchemaVersion = 'artifacts/v1';
    expect(() => assertKnownSchemaVersion(version)).not.toThrow();
  });

  it('refuses unknown schema versions', () => {
    expect(() => assertKnownSchemaVersion('artifacts/v9')).toThrow(/unknown artifact schema/);
    expect(() => assertKnownSchemaVersion('')).toThrow(/unknown artifact schema/);
    expect(() => assertKnownSchemaVersion(undefined)).toThrow(/unknown artifact schema/);
  });

  it('allocates server-side UUID identities clients cannot forge', () => {
    const first = createArtifactId();
    const second = createArtifactId();
    expect(first).not.toBe(second);
    expect(isArtifactId(first)).toBe(true);
    expect(isArtifactId('not-a-uuid')).toBe(false);
    expect(isArtifactId('')).toBe(false);
  });
});
