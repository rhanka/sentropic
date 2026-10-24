import { beforeEach, describe, expect, it } from 'vitest';
import type { ArtifactProviderProfile as FrozenProviderProfile,
  CompiledArtifactsProfile as FrozenCompiledProfile } from '../l0-freeze/profile-contract.js';
let compileArtifactsProfile: typeof import('../src/profile/index.js').compileArtifactsProfile;
let RADAR_ARTIFACTS_PROFILE: typeof import('../src/profile/index.js').RADAR_ARTIFACTS_PROFILE;

const compile = (selectedCapabilities = [...RADAR_ARTIFACTS_PROFILE.selectedCapabilities]) =>
  compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE, selectedCapabilities });

describe('compiled capability profile', () => {
  beforeEach(async () => {
    ({ compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } = await import('../src/profile/index.js'));
  });
  it('should compile the corrected L0 provider input and expose its inherited output fields', () => {
    const input: FrozenProviderProfile = { version: RADAR_ARTIFACTS_PROFILE.version,
      selectedCapabilities: ['artifacts_ensure', 'artifacts_publish', 'artifacts_list', 'artifacts_get'],
      operations: RADAR_ARTIFACTS_PROFILE.operations, contractRevisions: RADAR_ARTIFACTS_PROFILE.contractRevisions };
    const compiled: FrozenCompiledProfile = compileArtifactsProfile(input);
    expect(compiled.selectedCapabilities).toEqual(input.selectedCapabilities);
    expect(compiled.operations).toEqual(input.operations);
    expect(compiled.contractRevisions).toEqual(input.contractRevisions);
    expect(compiled.version).toBe(input.version);
    expect(compiled.profileDigest).toBe(compile().profileDigest);
    expect(Object.isFrozen(compiled.operations)).toBe(true);
  });

  it('should expose the corrected L0 selection projection without invocation correlation', () => {
    expect(() => compile([]).validate('artifacts_publish', null)).toThrowError(
      expect.objectContaining({ httpStatus: 503, category: 'capability_unselected',
        variant: 'unselected_operation', phase: 'selection', retriable: false, commitState: 'not_committed' }),
    );
  });
  it('should expose profile-bound L0 semantic validators and typed entry refusal', () => {
    const source = structuredClone(RADAR_ARTIFACTS_PROFILE);
    source.operations.find((op) => op.operation === 'ensure')!.limits.bindingNameMaxUnits = 2;
    source.operations.find((op) => op.operation === 'publish')!.limits.maxDecodedFileBytes = 1;
    const compiled: FrozenCompiledProfile = compileArtifactsProfile(source);
    const { validators } = compiled;
    expect(Object.isFrozen(validators)).toBe(true);
    expect(validators.validateBindingName('ab')).toBe(true);
    expect(validators.validateBindingName('abc')).toBe(false);
    expect(validators.validateCallerKey(' key ')).toBe(true);
    for (const key of [' ', '\ud800', 'x'.repeat(257)]) expect(validators.validateCallerKey(key)).toBe(false);
    const file = { path: 'a', mimeType: 'text/html', text: 'a' };
    expect(validators.validateFileEntry(file)).toBe(true);
    for (const change of [{ text: 'é' }, { path: 'api/a' }, { bytes: [97] }]) {
      expect(validators.validateFileEntry({ ...file, ...change })).toBe(false);
    }
    source.operations.find((op) => op.operation === 'publish')!.limits.maxDecodedFileBytes = 100;
    expect(validators.validateFileEntry({ ...file, text: 'aa' })).toBe(false);
    expect(() => compile().validate('artifacts_ensure', {})).toThrowError(expect.objectContaining({
      kind: 'ordinary', category: 'invalid_request', phase: 'entry', httpStatus: 400, retriable: false,
    }));
    expect(() => compile([]).validate('artifacts_publish', {})).toThrowError(
      expect.objectContaining({ kind: 'operational', category: 'capability_unselected' }));
  });
  it('should expose exactly the deterministic selected set when input order varies', () => {
    const a = compile();
    const b = compile([...RADAR_ARTIFACTS_PROFILE.selectedCapabilities].reverse());
    expect(a.selectedCapabilities).toEqual([
      'artifacts_ensure', 'artifacts_publish', 'artifacts_list', 'artifacts_get',
    ]);
    expect(Object.keys(a.schemas)).toEqual(a.selectedCapabilities);
    expect(b.profileDigest).toBe(a.profileDigest);
    expect(Object.isFrozen(a.selectedCapabilities)).toBe(true);
    expect(Object.isFrozen(a.schemas.artifacts_publish)).toBe(true);
  });

  it('should refuse missing, unknown and duplicate selections during composition', () => {
    for (const selectedCapabilities of [undefined, ['unknown'], ['artifacts_get', 'artifacts_get']]) {
      expect(() => compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE, selectedCapabilities } as never)).toThrow();
    }
  });

  it('should make empty selection unavailable before validating any arguments', () => {
    const profile = compile([]);
    expect(profile.selectedCapabilities).toEqual([]);
    expect(profile.schemas).toEqual({});
    expect(() => profile.validate('artifacts_publish', null)).toThrowError(
      expect.objectContaining({ category: 'capability_unselected', status: 503, retriable: false,
        phase: 'selection', commitState: 'not_committed' }),
    );
  });

  it('should change integrity evidence when semantic byte limits change without schema changes', () => {
    const source = structuredClone(RADAR_ARTIFACTS_PROFILE);
    const before = compileArtifactsProfile(source);
    source.operations.find((op) => op.operation === 'publish')!.limits.maxDecodedTotalBytes--;
    const after = compileArtifactsProfile(source);
    expect(after.schemas).toEqual(before.schemas);
    expect(after.profileDigest).not.toBe(before.profileDigest);
    source.contractRevisions.authorization = 'artifacts-authorization/v2';
    expect(compileArtifactsProfile(source).profileDigest).not.toBe(after.profileDigest);
    expect(before.profile.operations.find((op) => op.operation === 'publish')!.limits.maxDecodedTotalBytes)
      .toBe(262144);
  });

  it('should reject each missing operation limit or default during composition', () => {
    for (const operation of RADAR_ARTIFACTS_PROFILE.operations) {
      for (const section of ['limits', 'defaults'] as const) {
        for (const field of Object.keys(operation[section])) {
          const source = structuredClone(RADAR_ARTIFACTS_PROFILE);
          delete source.operations.find((op) => op.operation === operation.operation)![section][field];
          expect(() => compileArtifactsProfile(source), `${operation.operation}.${section}.${field}`).toThrow();
        }
      }
    }
    const source = structuredClone(RADAR_ARTIFACTS_PROFILE);
    source.selectedCapabilities = [];
    delete source.operations.find((op) => op.operation === 'publish')!.limits.maxDecodedTotalBytes;
    expect(() => compileArtifactsProfile(source)).toThrow();
  });

  it('should accept a one-byte publication under a complete semantic budget', () => {
    const source = structuredClone(RADAR_ARTIFACTS_PROFILE);
    source.operations.find((op) => op.operation === 'publish')!.limits.maxDecodedTotalBytes = 1;
    const compiled = compileArtifactsProfile(source);
    const args = { artifactId: '123e4567-e89b-12d3-a456-426614174000', idempotencyKey: 'key',
      files: [{ path: 'a', mimeType: 'text/html', text: 'a' }] };
    expect(compiled.validate('artifacts_publish', args).files)
      .toEqual([{ path: 'a', mimeType: 'text/html', bytes: [97] }]);
    expect(() => compiled.validate('artifacts_publish', { ...args,
      files: [{ ...args.files[0], text: 'ab' }] })).toThrow();
  });

  it('should reject unsupported versions and supplied mismatching schemas at composition', () => {
    expect(() => compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE, version: 'future' } as never)).toThrow();
    expect(() => compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE, schemas: {} } as never)).toThrow();
    const source = structuredClone(RADAR_ARTIFACTS_PROFILE);
    source.operations.find((op) => op.operation === 'list')!.defaults.limit = 101;
    expect(() => compileArtifactsProfile(source)).toThrow();
    const inconsistent = structuredClone(RADAR_ARTIFACTS_PROFILE);
    inconsistent.operations.find((op) => op.operation === 'ensure')!.limits.bindingNameMinUnits = 129;
    expect(() => compileArtifactsProfile(inconsistent)).toThrow();
    const keyMismatch = structuredClone(RADAR_ARTIFACTS_PROFILE);
    keyMismatch.operations.find((op) => op.operation === 'publish')!.limits.idempotencyKeyMaxUnits = 257;
    expect(() => compileArtifactsProfile(keyMismatch)).toThrow();
  });

  it('should generate closed schemas with required keys, explicit path restrictions and principal metadata', () => {
    const profile = compile();
    expect(profile.schemas.artifacts_ensure).toMatchObject({ additionalProperties: false,
      required: ['bindingName', 'idempotencyKey'] });
    expect(profile.schemas.artifacts_publish).toMatchObject({ additionalProperties: false,
      required: ['artifactId', 'files', 'idempotencyKey'] });
    expect(profile.idempotency.artifacts_publish).toEqual({ required: true, scope: 'principal' });
    expect(JSON.stringify(profile.schemas)).not.toMatch(/paramsHash|storageScopeId|ownerId/);
    expect(profile.profile.rules.pathMaxBytes).toBe(1024);
    expect(profile.profile.rules.reservedFirstSegments).toEqual(['api', '__artifacts', 'livez', 'health']);
  });

  it('should map only the selected exact Radar routes', () => {
    const profile = compile();
    expect(profile.capabilityForRoute('POST', '/ensure')).toBe('artifacts_ensure');
    expect(profile.capabilityForRoute('POST', '/publish')).toBe('artifacts_publish');
    expect(profile.capabilityForRoute('POST', '/list')).toBe('artifacts_list');
    expect(profile.capabilityForRoute('GET', '/meta/123e4567-e89b-12d3-a456-426614174000')).toBe('artifacts_get');
    for (const [method, path] of [['GET', '/list'], ['POST', '/delete'], ['POST', '/publish?x=1'],
      ['GET', '/meta/a/b'], ['GET', '/meta/INVALID']]) {
      expect(profile.capabilityForRoute(method, path)).toBeUndefined();
    }
    expect(compile([]).capabilityForRoute('POST', '/publish')).toBeUndefined();
  });
});
