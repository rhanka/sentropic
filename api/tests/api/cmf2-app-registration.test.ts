import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCanonicalPerAppTools,
  computeManifestDigest,
  computeProfileDigest,
  computeToolDefinitionsDigest,
  getToolMutability,
  isWriteTool,
  loadAppRegistrationsFromEnv,
  projectAppInstance,
  validateAppRegistration,
} from '../../src/services/artifacts/app-registration';

const SELECTED = ['artifacts_get', 'artifacts_list'];
const SUMMARIES = { artifacts_list: 'List Radar pages.' };
const RESOURCE = 'https://api.preprod.sent-tech.ca/api/v1/mcp/apps/radar-immobilier';

function digests() {
  const profileDigest = computeProfileDigest(SELECTED);
  const tools = buildCanonicalPerAppTools(SELECTED, SUMMARIES);
  const toolDefinitionsDigest = computeToolDefinitionsDigest(tools);
  const manifestDigest = computeManifestDigest(profileDigest, toolDefinitionsDigest, RESOURCE);
  return { profileDigest, toolDefinitionsDigest, manifestDigest };
}

function validRegistration() {
  const { profileDigest, toolDefinitionsDigest, manifestDigest } = digests();
  return {
    appInstanceId: 'radar-preprod',
    appSlug: 'radar-immobilier',
    environment: 'preprod' as const,
    tenantId: 'tenant-1',
    workspaceId: 'ws-1',
    storage: { storageScopeId: 'radar-immobilier-preprod', origin: 'imported' as const, quotaBytes: 1000, placement: 's3' as const },
    profile: { selectedCapabilities: [...SELECTED], profileDigest, manifestDigest },
    presentation: { toolSummaries: { ...SUMMARIES }, toolDefinitionsDigest },
    mcp: { resource: RESOURCE, clientIds: ['c1'] },
    knowledge: { repoId: 'rhanka/radar-immobilier', commitSha: 'a'.repeat(40), path: 'artifact-knowledge', digest: 'b'.repeat(64) },
    revision: 'r1',
    reviewedBy: ['owner'],
  };
}

afterEach(() => {
  delete process.env.CM_REGISTRATION_ENABLED;
  delete process.env.APP_ARTIFACT_REGISTRATIONS_JSON;
});

describe('CMF-2 registration validation', () => {
  it('should accept a valid imported registration with real digests', () => {
    const result = validateAppRegistration(validRegistration());
    expect(result.ok).toBe(true);
  });
  it('should refuse every §3.1 violation class with its reason', () => {
    const cases: [string, (v: ReturnType<typeof validRegistration>) => void][] = [
      ['unknown_app_instance', (v) => { v.appInstanceId = ''; }],
      ['slug_collision', (v) => { v.appSlug = 'Bad Slug!'; }],
      ['tenant_mismatch', (v) => { v.tenantId = ''; }],
      ['imported_scope_invalid', (v) => { v.storage.storageScopeId = 'bad/scope'; }],
      ['imported_scope_reserved', (v) => { v.storage.storageScopeId = 'artifact-foo'; }],
      ['imported_scope_reserved', (v) => { v.storage.storageScopeId = 'app-artifact-x'; }],
      ['placement_not_offered', (v) => { (v.storage as { placement: string }).placement = 'tape'; }],
      ['profile_digest_mismatch', (v) => { v.profile.profileDigest = 'c'.repeat(64); }],
      ['profile_digest_mismatch', (v) => { v.profile.selectedCapabilities = ['artifacts_list', 'nope']; }],
      ['served_definitions_digest_mismatch', (v) => { v.presentation.toolDefinitionsDigest = 'c'.repeat(64); }],
      ['knowledge_digest_mismatch', (v) => { v.knowledge.digest = 'zz'; }],
      ['knowledge_digest_mismatch', (v) => { v.knowledge.path = '../escape'; }],
      ['frame_ancestors_refused', (v) => { (v as Record<string, unknown>).embedding = { frameAncestors: ['http://evil.test'] }; }],
      ['frame_ancestors_refused', (v) => { (v as Record<string, unknown>).embedding = { frameAncestors: ['https://app.preprod.immo.sent-tech.ca/evil?x=1'] }; }],
      ['content_domain_collision', (v) => { (v as Record<string, unknown>).viewAddress = { appOrigin: 'https://app.preprod.immo.sent-tech.ca/path' }; }],
      ['quota_refused', (v) => { v.storage.quotaBytes = 0; }],
      ['quota_refused', (v) => { (v.storage as Record<string, unknown>).actorQuotas = { maxBytes: 0, ratePerWindow: 1, windowSeconds: 60 }; }],
      ['quota_refused', (v) => { (v.storage as Record<string, unknown>).actorQuotas = { maxBytes: 10, ratePerWindow: -1, windowSeconds: 60 }; }],
      ['domain_not_enabled_in_t4a', (v) => { (v as Record<string, unknown>).domain = { module: {} }; }],
      ['revision_not_reviewed', (v) => { v.reviewedBy = []; }],
    ];
    for (const [reason, mutate] of cases) {
      const v = validRegistration();
      mutate(v);
      const result = validateAppRegistration(v);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(reason);
    }
  });
  it('should require native scopes to be UUIDs and imported scopes to avoid reserved namespaces', () => {
    const native = { ...validRegistration(), storage: { storageScopeId: '123e4567-e89b-12d3-a456-426614174000', origin: 'native', quotaBytes: 1000, placement: 's3' } } as unknown as Parameters<typeof validateAppRegistration>[0];
    const { profileDigest, toolDefinitionsDigest, manifestDigest } = digests();
    (native as Record<string, unknown>).profile = { selectedCapabilities: [...SELECTED], profileDigest, manifestDigest };
    (native as Record<string, unknown>).presentation = { toolSummaries: { ...SUMMARIES }, toolDefinitionsDigest };
    expect(validateAppRegistration(native).ok).toBe(true);
    const badNative = JSON.parse(JSON.stringify(native)) as typeof validRegistration & { storage: { storageScopeId: string } };
    badNative.storage.storageScopeId = 'not-a-uuid';
    expect(validateAppRegistration(badNative).ok).toBe(false);
  });
  it('should authorize each served tool per its mutability', () => {
    expect(getToolMutability('artifacts_list')).toBe('read-only');
    expect(isWriteTool('artifacts_list')).toBe(false);
    expect(isWriteTool('artifacts_publish')).toBe(true);
    const tools = buildCanonicalPerAppTools(SELECTED, SUMMARIES);
    expect(tools.map((tool) => tool.name)).toEqual(['artifacts_get', 'artifacts_list']);
    expect(tools.find((tool) => tool.name === 'artifacts_list')?.description).toBe('List Radar pages.');
  });
  it('should project control.app_instances with imported-scope binding', () => {
    const result = validateAppRegistration(validRegistration());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const projected = projectAppInstance(result.value);
    expect(projected.id).toBe('radar-preprod');
    expect(projected.tenantId).toBe('tenant-1');
    expect(projected.controlEnvironment).toBe('preview');
    expect(projected.storageScopeId).toBe('radar-immobilier-preprod');
    expect(projected.storageOrigin).toBe('imported');
    expect(projected.mcpResource).toBe(RESOURCE);
  });
  it('should refuse cross-registration collisions and keep the first', () => {
    process.env.CM_REGISTRATION_ENABLED = '1';
    try {
      const makeFor = (overrides: { appSlug: string; appInstanceId: string; storageScopeId: string; resource: string }) => {
        const profileDigest = computeProfileDigest(SELECTED);
        const tools = buildCanonicalPerAppTools(SELECTED, SUMMARIES);
        const toolDefinitionsDigest = computeToolDefinitionsDigest(tools);
        const manifestDigest = computeManifestDigest(profileDigest, toolDefinitionsDigest, overrides.resource);
        return {
          appInstanceId: overrides.appInstanceId,
          appSlug: overrides.appSlug,
          environment: 'preprod' as const,
          tenantId: 'tenant-1',
          workspaceId: 'ws-1',
          storage: { storageScopeId: overrides.storageScopeId, origin: 'imported' as const, quotaBytes: 1000, placement: 's3' as const },
          profile: { selectedCapabilities: [...SELECTED], profileDigest, manifestDigest },
          presentation: { toolSummaries: { ...SUMMARIES }, toolDefinitionsDigest },
          mcp: { resource: overrides.resource, clientIds: ['c1'] },
          knowledge: { repoId: 'rhanka/radar-immobilier', commitSha: 'a'.repeat(40), path: 'artifact-knowledge', digest: 'b'.repeat(64) },
          revision: 'r1',
          reviewedBy: ['owner'],
        };
      };
      const good = makeFor({ appSlug: 'radar-immobilier', appInstanceId: 'radar-preprod', storageScopeId: 'radar-immobilier-preprod', resource: RESOURCE });
      const clashSlug = makeFor({ appSlug: 'radar-immobilier', appInstanceId: 'other-id', storageScopeId: 'other-scope', resource: 'https://api.preprod.sent-tech.ca/api/v1/mcp/apps/other' });
      const clashScope = makeFor({ appSlug: 'other-slug', appInstanceId: 'third-id', storageScopeId: 'radar-immobilier-preprod', resource: 'https://api.preprod.sent-tech.ca/api/v1/mcp/apps/third' });
      process.env.APP_ARTIFACT_REGISTRATIONS_JSON = JSON.stringify([good, clashSlug, clashScope, { appSlug: '!!' }]);
      const { loaded, refused } = loadAppRegistrationsFromEnv();
      expect(loaded).toHaveLength(1);
      expect(refused.map((entry) => entry.reason)).toContain('slug_collision');
      expect(refused.map((entry) => entry.reason)).toContain('scope_collision');
    } finally {
      delete process.env.APP_ARTIFACT_REGISTRATIONS_JSON;
      delete process.env.CM_REGISTRATION_ENABLED;
    }
  });
  it('should refuse a bad registration alone and keep the good one', () => {
    process.env.CM_REGISTRATION_ENABLED = '1';
    try {
      const good = validRegistration();
      process.env.APP_ARTIFACT_REGISTRATIONS_JSON = JSON.stringify([good, { appSlug: '!!' }]);
      const { loaded, refused } = loadAppRegistrationsFromEnv();
      expect(loaded).toHaveLength(1);
      expect(refused).toHaveLength(1);
    } finally {
      delete process.env.APP_ARTIFACT_REGISTRATIONS_JSON;
      delete process.env.CM_REGISTRATION_ENABLED;
    }
  });
  it('should stay disabled behind the flag', () => {
    process.env.APP_ARTIFACT_REGISTRATIONS_JSON = JSON.stringify([validRegistration()]);
    try {
      expect(loadAppRegistrationsFromEnv().loaded).toHaveLength(0);
    } finally {
      delete process.env.APP_ARTIFACT_REGISTRATIONS_JSON;
    }
  });
});
