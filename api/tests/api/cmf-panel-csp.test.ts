import { describe, expect, it } from 'vitest';
import { buildPanelCsp, isPanelEnabled, resolvePanelFrameAncestors } from '../../src/services/artifacts/artifact-panel';
import type { AppArtifactsRegistration } from '../../src/services/artifacts/app-registration';

const HEX64 = 'c'.repeat(64);
function registration(ancestors: string[]): AppArtifactsRegistration {
  return {
    appInstanceId: 'radar-preprod', appSlug: 'radar-immobilier', environment: 'preprod',
    tenantId: 'tenant-radar', workspaceId: 'ws-1',
    storage: { storageScopeId: 'radar-immobilier-preprod', origin: 'imported', quotaBytes: 1000, placement: 's3' },
    profile: { selectedCapabilities: ['read'], profileDigest: HEX64, manifestDigest: HEX64 },
    presentation: { toolSummaries: {}, toolDefinitionsDigest: HEX64 },
    mcp: { resource: 'https://api.preprod.sent-tech.ca/api/v1/mcp/apps/radar-immobilier', clientIds: [] },
    knowledge: { repoId: 'r', commitSha: 'a'.repeat(40), path: 'k', digest: HEX64 },
    embedding: { frameAncestors: ancestors },
    revision: 'r1', reviewedBy: ['owner'],
  };
}

describe('W4.c panel content policy', () => {
  it('respects frame ancestors from the registration', () => {
    const ancestors = ['https://app.preprod.immo.sent-tech.ca'];
    expect(resolvePanelFrameAncestors(registration(ancestors))).toEqual(ancestors);
    expect(buildPanelCsp(registration(ancestors))).toContain(`frame-ancestors ${ancestors[0]}`);
  });
  it('refuses non-https ancestors fail-closed', () => {
    expect(() => resolvePanelFrameAncestors(registration(['http://evil.test']))).toThrow('frame_ancestors_refused');
    expect(() => resolvePanelFrameAncestors(registration([]))).toThrow('frame_ancestors_refused');
  });
  it('stays disabled behind the flag', () => {
    delete process.env.CM_PANEL_ENABLED;
    expect(isPanelEnabled()).toBe(false);
  });
});
