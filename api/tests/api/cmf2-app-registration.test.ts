import { describe, expect, it } from 'vitest';
import { loadAppRegistrationsFromEnv, validateAppRegistration } from '../src/services/artifacts/app-registration';

const HEX64 = 'a'.repeat(64);
function validRegistration() {
  return {
    appInstanceId: 'radar-preprod',
    appSlug: 'radar-immobilier',
    environment: 'preprod',
    tenantId: 'tenant-1',
    workspaceId: 'ws-1',
    storage: { storageScopeId: 'radar-immobilier-preprod', origin: 'imported', quotaBytes: 1000, placement: 's3' },
    profile: { selectedCapabilities: ['read'], profileDigest: HEX64, manifestDigest: HEX64 },
    presentation: { toolSummaries: { artifacts_list: 'List.' }, toolDefinitionsDigest: HEX64 },
    mcp: { resource: 'https://api.preprod.sent-tech.ca/api/v1/mcp/apps/radar-immobilier', clientIds: ['c1'] },
    knowledge: { repoId: 'rhanka/radar-immobilier', commitSha: 'a'.repeat(40), path: 'artifact-knowledge', digest: HEX64 },
    revision: 'r1',
    reviewedBy: ['owner'],
  };
}

describe('CMF-2 registration validation', () => {
  it('should accept a valid imported registration', () => {
    expect(validateAppRegistration(validRegistration()).ok).toBe(true);
  });
  it('should refuse every §3.1 violation class', () => {
    const cases: [string, (v: ReturnType<typeof validRegistration>) => void][] = [
      ['unknown_app_instance', (v) => { v.appInstanceId = ''; }],
      ['slug_collision', (v) => { v.appSlug = 'Bad Slug!'; }],
      ['tenant_mismatch', (v) => { v.tenantId = ''; }],
      ['imported_scope_invalid', (v) => { v.storage.storageScopeId = 'bad/scope'; }],
      ['imported_scope_reserved', (v) => { v.storage.storageScopeId = 'artifact-foo'; }],
      ['placement_not_offered', (v) => { v.storage.placement = 'tape'; }],
      ['profile_digest_mismatch', (v) => { v.profile.profileDigest = 'zz'; }],
      ['served_definitions_digest_mismatch', (v) => { v.presentation.toolDefinitionsDigest = 'zz'; }],
      ['knowledge_digest_mismatch', (v) => { v.knowledge.digest = 'zz'; }],
      ['frame_ancestors_refused', (v) => { v.embedding = { frameAncestors: ['http://evil.test'] }; }],
      ['domain_not_enabled_in_t4a', (v) => { v.domain = { module: {} }; }],
    ];
    for (const [, mutate] of cases) {
      const v = validRegistration() as never as ReturnType<typeof validRegistration> & Record<string, unknown>;
      (mutate as (v: never) => void)(v as never);
      expect(validateAppRegistration(v).ok).toBe(false);
    }
  });
  it('should refuse a bad registration alone and keep the good one', () => {
    process.env.CM_REGISTRATION_ENABLED = '1';
    const good = validRegistration();
    process.env.APP_ARTIFACT_REGISTRATIONS_JSON = JSON.stringify([good, { appSlug: '!!' }]);
    const { loaded, refused } = loadAppRegistrationsFromEnv();
    expect(loaded).toHaveLength(1);
    expect(refused).toHaveLength(1);
    delete process.env.APP_ARTIFACT_REGISTRATIONS_JSON;
    delete process.env.CM_REGISTRATION_ENABLED;
  });
  it('should stay disabled behind the flag', () => {
    delete process.env.CM_REGISTRATION_ENABLED;
    process.env.APP_ARTIFACT_REGISTRATIONS_JSON = JSON.stringify([validRegistration()]);
    expect(loadAppRegistrationsFromEnv().loaded).toHaveLength(0);
    delete process.env.APP_ARTIFACT_REGISTRATIONS_JSON;
  });
});
