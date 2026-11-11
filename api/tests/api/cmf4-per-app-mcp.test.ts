import { describe, expect, it } from 'vitest';
import { buildPerAppToolList, perAppToolsBytes, resolvePerAppAuth } from '../../src/routes/namespaces/mcp-apps';
import type { AppArtifactsRegistration } from '../../src/services/artifacts/app-registration';

const HEX64 = 'b'.repeat(64);
function registration(): AppArtifactsRegistration {
  return {
    appInstanceId: 'radar-preprod', appSlug: 'radar-immobilier', environment: 'preprod',
    tenantId: 'tenant-radar', workspaceId: 'ws-1',
    storage: { storageScopeId: 'radar-immobilier-preprod', origin: 'imported', quotaBytes: 1000, placement: 's3' },
    profile: { selectedCapabilities: ['read'], profileDigest: HEX64, manifestDigest: HEX64 },
    presentation: { toolSummaries: { artifacts_list: 'List Radar pages.' }, toolDefinitionsDigest: HEX64 },
    mcp: { resource: 'https://api.preprod.sent-tech.ca/api/v1/mcp/apps/radar-immobilier', clientIds: ['immo-mcp'] },
    knowledge: { repoId: 'r', commitSha: 'c'.repeat(40), path: 'k', digest: HEX64 },
    revision: 'r1', reviewedBy: ['owner'],
  };
}

describe('CMF-4 per-app MCP', () => {
  it('should refuse wrong audience with 401', () => {
    const reg = registration();
    expect(resolvePerAppAuth(reg, { audience: 'https://evil.test/x', tid: reg.tenantId, member: true }))
      .toEqual({ ok: false, status: 401, error: 'wrong_audience' });
  });
  it('should refuse non-member and wrong tenant with 403', () => {
    const reg = registration();
    expect(resolvePerAppAuth(reg, { audience: reg.mcp.resource, tid: reg.tenantId, member: false }).ok).toBe(false);
    expect(resolvePerAppAuth(reg, { audience: reg.mcp.resource, tid: 'other', member: true }))
      .toEqual({ ok: false, status: 403, error: 'tenant_pinned' });
  });
  it('should pin a multi-tenant user to the app tid', () => {
    const reg = registration();
    expect(resolvePerAppAuth(reg, { audience: reg.mcp.resource, tid: reg.tenantId, member: true }))
      .toEqual({ ok: true });
  });
  it('should serve the registration wording overlay byte-identically', () => {
    const reg = registration();
    const tools = buildPerAppToolList(reg);
    const listed = tools.find((t) => t.name === 'artifacts_list');
    expect(listed?.description).toBe('List Radar pages.');
    expect(perAppToolsBytes(reg)).toBe(JSON.stringify(tools));
  });
});
