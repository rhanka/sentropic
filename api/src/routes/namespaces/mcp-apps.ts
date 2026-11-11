import { Hono } from 'hono';
import { ARTIFACTS_TOOL_DEFINITIONS } from '@sentropic/artifacts/mcp-core';
import type { AppArtifactsRegistration } from '../services/artifacts/app-registration';

export const isPerAppMcpEnabled = (): boolean => process.env.CM_PER_APP_MCP_ENABLED === '1';

export interface PerAppAuthInput {
  audience: string | undefined;
  tid: string | undefined;
  member: boolean;
}

/** Fail-closed per-app auth: 401 wrong audience, 403 non-member or wrong tenant. */
export function resolvePerAppAuth(registration: AppArtifactsRegistration, input: PerAppAuthInput):
  { ok: true } | { ok: false; status: 401 | 403; error: string } {
  if (!input.audience || input.audience !== registration.mcp.resource) {
    return { ok: false, status: 401, error: 'wrong_audience' };
  }
  if (!input.tid || input.tid !== registration.tenantId) return { ok: false, status: 403, error: 'tenant_pinned' };
  if (!input.member) return { ok: false, status: 403, error: 'non_member' };
  return { ok: true };
}

/** Served definitions: package definitions with the registration wording overlay. */
export function buildPerAppToolList(registration: AppArtifactsRegistration):
  { name: string; description: string; inputSchema: unknown }[] {
  return Object.values(ARTIFACTS_TOOL_DEFINITIONS).map((tool) => ({
    name: tool.name,
    description: registration.presentation.toolSummaries[tool.name] ?? tool.description,
    inputSchema: tool.inputSchema,
  }));
}

/** Canonical bytes of the served list, for the byte-identical acceptance check. */
export function perAppToolsBytes(registration: AppArtifactsRegistration): string {
  return JSON.stringify(buildPerAppToolList(registration));
}

/** Additive per-app router. Mounted behind CM_PER_APP_MCP_ENABLED, generic /mcp untouched. */
export function createPerAppMcpRouter(load: (slug: string) => AppArtifactsRegistration | undefined): Hono {
  const router = new Hono();
  router.get('/api/v1/mcp/apps/:slug/tools', (c) => {
    if (!isPerAppMcpEnabled()) return c.json({ error: 'disabled' }, 404);
    const registration = load(c.req.param('slug'));
    if (!registration) return c.json({ error: 'unknown_app' }, 404);
    const auth = resolvePerAppAuth(registration, {
      audience: c.req.header('x-mcp-audience') ?? new URL(c.req.url).origin + `/api/v1/mcp/apps/${c.req.param('slug')}`,
      tid: c.req.query('tid'),
      member: c.req.query('member') === '1',
    });
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    return c.json({ tools: buildPerAppToolList(registration) });
  });
  router.get('/api/v1/mcp/apps/:slug/.well-known/oauth-protected-resource', (c) => {
    const registration = load(c.req.param('slug'));
    if (!registration || !isPerAppMcpEnabled()) return c.json({ error: 'unknown_app' }, 404);
    return c.json({ resource: registration.mcp.resource, tenant: registration.tenantId,
      authorization_servers: ['https://id.sent-tech.ca'], scopes_supported: ['mcp:discover', 'mcp:tools:invoke'] });
  });
  return router;
}
