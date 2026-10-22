import { beforeEach, describe, expect, it } from 'vitest';
let compileArtifactsProfile: typeof import('../src/profile/index.js').compileArtifactsProfile;
let RADAR_ARTIFACTS_PROFILE: typeof import('../src/profile/index.js').RADAR_ARTIFACTS_PROFILE;

const compile = (tools = [...RADAR_ARTIFACTS_PROFILE.selection.tools]) =>
  compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE, selection: { tools } });

describe('compiled capability profile', () => {
  beforeEach(async () => {
    ({ compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } = await import('../src/profile/index.js'));
  });
  it('should expose exactly the deterministic selected set when input order varies', () => {
    const a = compile();
    const b = compile([...RADAR_ARTIFACTS_PROFILE.selection.tools].reverse());
    expect(a.selectedCapabilities).toEqual([
      'artifacts_ensure', 'artifacts_publish', 'artifacts_list', 'artifacts_get',
    ]);
    expect(Object.keys(a.schemas)).toEqual(a.selectedCapabilities);
    expect(b.profileDigest).toBe(a.profileDigest);
    expect(Object.isFrozen(a.selectedCapabilities)).toBe(true);
    expect(Object.isFrozen(a.schemas.artifacts_publish)).toBe(true);
  });

  it('should refuse missing, unknown and duplicate selections during composition', () => {
    for (const selection of [undefined, { tools: ['unknown'] }, { tools: ['artifacts_get', 'artifacts_get'] }]) {
      expect(() => compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE, selection } as never)).toThrow();
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

  it('should reject unsupported versions and supplied mismatching schemas at composition', () => {
    expect(() => compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE, version: 'future' } as never)).toThrow();
    expect(() => compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE, schemas: {} } as never)).toThrow();
    const source = structuredClone(RADAR_ARTIFACTS_PROFILE);
    source.operations.find((op) => op.operation === 'list')!.defaults.limit = 101;
    expect(() => compileArtifactsProfile(source)).toThrow();
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
