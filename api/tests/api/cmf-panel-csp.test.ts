import { afterEach, describe, expect, it } from 'vitest';
import { buildPanelCsp, createPanelRouter, isPanelEnabled, isStrictHttpsOrigin, resolvePanelFrameAncestors } from '../../src/services/artifacts/artifact-panel';
import type { AppArtifactsRegistration } from '../../src/services/artifacts/app-registration';

const HEX64 = 'c'.repeat(64);
function registration(ancestors: string[], environment: 'preprod' | 'prod' = 'preprod'): AppArtifactsRegistration {
  return {
    appInstanceId: 'radar-preprod',
    appSlug: 'radar-immobilier',
    environment,
    tenantId: 'tenant-radar',
    workspaceId: 'ws-1',
    storage: { storageScopeId: 'radar-immobilier-preprod', origin: 'imported', quotaBytes: 1000, placement: 's3' },
    profile: { selectedCapabilities: ['read'], profileDigest: HEX64, manifestDigest: HEX64 },
    presentation: { toolSummaries: {}, toolDefinitionsDigest: HEX64 },
    mcp: { resource: 'https://api.preprod.sent-tech.ca/api/v1/mcp/apps/radar-immobilier', clientIds: [] },
    knowledge: { repoId: 'r', commitSha: 'a'.repeat(40), path: 'k', digest: HEX64 },
    embedding: { frameAncestors: ancestors },
    revision: 'r1',
    reviewedBy: ['owner'],
  };
}

afterEach(() => {
  delete process.env.CM_PANEL_ENABLED;
});

describe('W4.c panel content policy', () => {
  it('respects frame ancestors from the registration', () => {
    const ancestors = ['https://app.preprod.immo.sent-tech.ca'];
    expect(resolvePanelFrameAncestors(registration(ancestors))).toEqual(ancestors);
    expect(buildPanelCsp(registration(ancestors))).toContain(`frame-ancestors ${ancestors[0]}`);
  });
  it('refuses non-https and non-origin ancestors fail-closed', () => {
    expect(() => resolvePanelFrameAncestors(registration(['http://evil.test']))).toThrow('frame_ancestors_refused');
    expect(() => resolvePanelFrameAncestors(registration([]))).toThrow('frame_ancestors_refused');
    expect(() => resolvePanelFrameAncestors(registration(['https://app.preprod.immo.sent-tech.ca/path?x=1#frag']))).toThrow('frame_ancestors_refused');
    expect(() => resolvePanelFrameAncestors(registration(['https://user:pass@app.preprod.immo.sent-tech.ca']))).toThrow('frame_ancestors_refused');
    expect(isStrictHttpsOrigin('https://app.preprod.immo.sent-tech.ca/path')).toBe(false);
  });
  it('refuses cross-environment ancestors', () => {
    expect(() => resolvePanelFrameAncestors(registration(['https://app.immo.sent-tech.ca'], 'preprod'))).toThrow('frame_ancestors_refused');
    expect(() => resolvePanelFrameAncestors(registration(['https://app.preprod.immo.sent-tech.ca'], 'prod'))).toThrow('frame_ancestors_refused');
  });
  it('serves the CSP behind the flag and refuses otherwise', async () => {
    process.env.CM_PANEL_ENABLED = '1';
    try {
      const load = (slug: string) =>
        slug === 'radar-immobilier' ? registration(['https://app.preprod.immo.sent-tech.ca']) : undefined;
      const router = createPanelRouter(load);
      const ok = await router.request('/api/v1/panel/apps/radar-immobilier/csp');
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { csp: string }).csp).toContain('frame-ancestors https://app.preprod.immo.sent-tech.ca');
      const unknown = await router.request('/api/v1/panel/apps/unknown/csp');
      expect(unknown.status).toBe(404);
    } finally {
      delete process.env.CM_PANEL_ENABLED;
    }
  });
  it('stays disabled behind the flag', async () => {
    delete process.env.CM_PANEL_ENABLED;
    expect(isPanelEnabled()).toBe(false);
    const router = createPanelRouter(() => registration(['https://app.preprod.immo.sent-tech.ca']));
    const res = await router.request('/api/v1/panel/apps/radar-immobilier/csp');
    expect(res.status).toBe(404);
  });
});
