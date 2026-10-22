import { beforeEach, describe, expect, it } from 'vitest';
let compileArtifactsProfile: typeof import('../src/profile/index.js').compileArtifactsProfile;
let RADAR_ARTIFACTS_PROFILE: typeof import('../src/profile/index.js').RADAR_ARTIFACTS_PROFILE;
let createArtifactCommand: typeof import('../src/server/command-identity.js').createArtifactCommand;
let createRadarKeyDerivation: typeof import('../src/server/command-identity.js').createRadarKeyDerivation;
let commandDigest: typeof import('../src/server/command-identity.js').commandDigest;
import { manifestDigest } from '../src/codecs.js';

const artifactId = '123e4567-e89b-12d3-a456-426614174000';
const host = { storageScopeId: 'scope-1', actorId: 'user-sub-1' };
const binding = () => createRadarKeyDerivation({ storageScopeId: host.storageScopeId });
const publish = (overrides = {}) => ({ artifactId, idempotencyKey: 'client-key-1',
  files: [{ path: 'index.html', mimeType: 'text/html', text: 'hello' }], ...overrides });
const command = (args = publish(), authority = host) => createArtifactCommand(
  compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE), 'artifacts_publish', args, authority, binding(),
);

describe('effective command identity', () => {
  beforeEach(async () => {
    ({ compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } = await import('../src/profile/index.js'));
    ({ createArtifactCommand, createRadarKeyDerivation, commandDigest } = await import('../src/server/command-identity.js'));
  });
  it('should retain the existing Radar key vector and separate all identity values', () => {
    const value = command();
    expect(value.identity.internalKey).toBe('9a159e31bdd2a0415be1bf65c70e37c29d5076365616af5acc356ee8210c8ff1');
    expect(command(publish({ idempotencyKey: 'Été 🏠' })).identity.internalKey)
      .toBe('cdbd12ef59da02ab7ad392f06f60bb101f49b78635be07ea0d6c3210ae08afa4');
    expect(value.identity.codecVersion).toBe('artifacts-command/v1');
    expect(value.identity.commandHash).not.toBe(value.identity.internalKey);
    expect(commandDigest({ b: 2, a: 1 })).toBe('43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
  });

  it('should converge equivalent text/bytes and property order after defaults and forced provenance', () => {
    const text = command(publish({ profile: { b: true, a: 'x' } }));
    const bytes = command(publish({ files: [{ path: 'index.html', mimeType: 'text/html', bytes: [104, 101, 108, 108, 111] }],
      profile: { a: 'x', b: true } }));
    expect(text.identity).toEqual(bytes.identity);
    expect(text.provenance).toEqual({ kind: 'inline-original' });
    expect(command().payload.profile).toEqual({});
    expect(command().scopeBinding).toBe('scope-1');
  });

  it('should conflict on changed bytes, path, MIME, profile and array order without changing the durable key', () => {
    const base = command();
    for (const change of [{ files: [{ path: 'other.html', mimeType: 'text/html', text: 'hello' }] },
      { files: [{ path: 'index.html', mimeType: 'text/css', text: 'hello' }] },
      { files: [{ path: 'index.html', mimeType: 'text/html', text: 'changed' }] }, { profile: { theme: 'dark' } }]) {
      const changed = command(publish(change));
      expect(changed.identity.internalKey).toBe(base.identity.internalKey);
      expect(changed.identity.commandHash).not.toBe(base.identity.commandHash);
    }
    const files = [publish().files[0], { path: 'b.css', mimeType: 'text/css', text: 'b' }];
    expect(command(publish({ files })).identity.commandHash)
      .not.toBe(command(publish({ files: [...files].reverse() })).identity.commandHash);
    const manifest = { schemaVersion: 'artifacts/v1', artifactId, files };
    expect(manifestDigest(manifest)).toBe(manifestDigest({ ...manifest, files: [...files].reverse() }));
  });

  it('should preserve whitespace, Unicode normalization distinctions and canonical actor domains', () => {
    expect(command(publish({ idempotencyKey: ' key ' })).identity.internalKey)
      .not.toBe(command(publish({ idempotencyKey: 'key' })).identity.internalKey);
    expect(command(publish({ idempotencyKey: 'é' })).identity.internalKey)
      .not.toBe(command(publish({ idempotencyKey: 'e\u0301' })).identity.internalKey);
    expect(command(publish(), { ...host, actorId: 'alice' }).identity.internalKey)
      .not.toBe(command(publish(), { ...host, actorId: 'issuer|alice' }).identity.internalKey);
  });

  it('should refuse ambiguous scope configuration and mismatching trusted bindings', () => {
    expect(() => createRadarKeyDerivation({ storageScopeId: 'scope|issuer' })).toThrow();
    expect(() => command(publish(), { ...host, storageScopeId: 'other' })).toThrow();
    expect(() => command(publish(), { ...host, actorId: '\ud800' })).toThrow();
  });

  it('should isolate the effective command from later caller mutation and exclude caller key from payload hash', () => {
    const input = publish({ profile: { theme: 'light' } });
    const value = command(input);
    input.files[0].text = 'mutated';
    expect(value.payload.files).toEqual([{ path: 'index.html', mimeType: 'text/html', bytes: [104, 101, 108, 108, 111] }]);
    expect(Object.isFrozen(value.payload)).toBe(true);
    expect(command(publish({ idempotencyKey: 'other-key' })).identity.commandHash).toBe(command().identity.commandHash);
  });
});
