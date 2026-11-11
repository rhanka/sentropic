import { afterEach, describe, expect, it } from 'vitest';
import { createPerAppMcpRouter, buildPerAppToolList, perAppToolsBytes } from '../../src/routes/namespaces/mcp-apps';
import {
  buildCanonicalPerAppTools,
  computeManifestDigest,
  computeProfileDigest,
  computeToolDefinitionsDigest,
  type AppArtifactsRegistration,
} from '../../src/services/artifacts/app-registration';

const SELECTED = ['artifacts_get', 'artifacts_list', 'artifacts_publish'];
const SUMMARIES = { artifacts_list: 'List Radar pages.' };
const RESOURCE = 'https://api.preprod.sent-tech.ca/api/v1/mcp/apps/radar-immobilier';
const TENANT = 'tenant-radar';
const WORKSPACE = 'ws-1';

function registration(): AppArtifactsRegistration {
  const profileDigest = computeProfileDigest(SELECTED);
  const tools = buildCanonicalPerAppTools(SELECTED, SUMMARIES);
  const toolDefinitionsDigest = computeToolDefinitionsDigest(tools);
  const manifestDigest = computeManifestDigest(profileDigest, toolDefinitionsDigest, RESOURCE);
  return {
    appInstanceId: 'radar-preprod',
    appSlug: 'radar-immobilier',
    environment: 'preprod',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    storage: { storageScopeId: 'radar-immobilier-preprod', origin: 'imported', quotaBytes: 1000, placement: 's3' },
    profile: { selectedCapabilities: [...SELECTED], profileDigest, manifestDigest },
    presentation: { toolSummaries: { ...SUMMARIES }, toolDefinitionsDigest },
    mcp: { resource: RESOURCE, clientIds: ['immo-mcp'] },
    knowledge: { repoId: 'r', commitSha: 'c'.repeat(40), path: 'k', digest: 'd'.repeat(64) },
    revision: 'r1',
    reviewedBy: ['owner'],
  };
}

function routerWithStubs() {
  const reg = registration();
  const load = (slug: string) => (slug === reg.appSlug ? reg : undefined);
  const verifyBearer = async (req: Request) => {
    const header = req.headers.get('authorization') ?? '';
    const token = header.replace(/^Bearer\s+/i, '');
    if (token === 'good' || token === 'good-query-ignored' || token === 'good-header-ignored') {
      return { sub: 'u1', clientId: 'c1', tid: TENANT, scopes: ['mcp:discover', 'mcp:tools:invoke'] as const };
    }
    if (token === 'wrong-tid') {
      return { sub: 'u1', clientId: 'c1', tid: 'other', scopes: ['mcp:discover', 'mcp:tools:invoke'] as const };
    }
    if (token === 'non-member-sub') {
      return { sub: 'u-nonmember', clientId: 'c1', tid: TENANT, scopes: ['mcp:discover', 'mcp:tools:invoke'] as const };
    }
    throw { status: 401 };
  };
  const isMember = async (sub: string) => sub !== 'u-nonmember';
  const router = createPerAppMcpRouter(load, { verifyBearer, isMember });
  return { router, reg };
}

afterEach(() => {
  delete process.env.CM_PER_APP_MCP_ENABLED;
});

describe('CMF-4 per-app MCP', () => {
  it('should refuse wrong audience with 401 and challenge, ignoring client headers and query', async () => {
    process.env.CM_PER_APP_MCP_ENABLED = '1';
    try {
      const { router } = routerWithStubs();
      const withEvilHelpers = await router.request(
        `/api/v1/mcp/apps/radar-immobilier/tools?tid=${TENANT}&member=1`,
        { headers: { authorization: 'Bearer wrong-aud', 'x-mcp-audience': RESOURCE } },
      );
      expect(withEvilHelpers.status).toBe(401);
      const challenge = withEvilHelpers.headers.get('www-authenticate') ?? '';
      expect(challenge).toContain('resource_metadata');
    } finally {
      delete process.env.CM_PER_APP_MCP_ENABLED;
    }
  });
  it('should refuse non-member and wrong tenant with 403', async () => {
    process.env.CM_PER_APP_MCP_ENABLED = '1';
    try {
      const { router } = routerWithStubs();
      const nonMember = await router.request('/api/v1/mcp/apps/radar-immobilier/tools', {
        headers: { authorization: 'Bearer non-member-sub' },
      });
      expect(nonMember.status).toBe(403);
      const wrongTenant = await router.request('/api/v1/mcp/apps/radar-immobilier/tools', {
        headers: { authorization: 'Bearer wrong-tid' },
      });
      expect(wrongTenant.status).toBe(403);
      expect(((await wrongTenant.json()) as { error: string }).error).toBe('tenant_pinned');
    } finally {
      delete process.env.CM_PER_APP_MCP_ENABLED;
    }
  });
  it('should pin a multi-tenant user to the app tid and ignore query tid', async () => {
    process.env.CM_PER_APP_MCP_ENABLED = '1';
    try {
      const { router } = routerWithStubs();
      const res = await router.request(`/api/v1/mcp/apps/radar-immobilier/tools?tid=other&member=1`, {
        headers: { authorization: 'Bearer good-query-ignored' },
      });
      expect(res.status).toBe(200);
    } finally {
      delete process.env.CM_PER_APP_MCP_ENABLED;
    }
  });
  it('should ignore a forged x-mcp-audience header when the bearer is valid', async () => {
    process.env.CM_PER_APP_MCP_ENABLED = '1';
    try {
      const { router } = routerWithStubs();
      const res = await router.request('/api/v1/mcp/apps/radar-immobilier/tools', {
        headers: { authorization: 'Bearer good-header-ignored', 'x-mcp-audience': 'https://evil.test/x' },
      });
      expect(res.status).toBe(200);
    } finally {
      delete process.env.CM_PER_APP_MCP_ENABLED;
    }
  });
  it('should serve the registration wording overlay byte-identically on REST', async () => {
    process.env.CM_PER_APP_MCP_ENABLED = '1';
    try {
      const { router, reg } = routerWithStubs();
      const tools = buildPerAppToolList(reg);
      expect(tools.find((tool) => tool.name === 'artifacts_list')?.description).toBe('List Radar pages.');
      const rest = await router.request('/api/v1/mcp/apps/radar-immobilier/tools', {
        headers: { authorization: 'Bearer good' },
      });
      expect(rest.status).toBe(200);
      const restBody = (await rest.json()) as { tools: unknown[] };
      expect(JSON.stringify(restBody.tools)).toBe(perAppToolsBytes(reg));
    } finally {
      delete process.env.CM_PER_APP_MCP_ENABLED;
    }
  });
});
