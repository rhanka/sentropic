import { createMcpAuth, MCP_SCOPES, type McpAuth } from '@sentropic/mcp-auth';
import { getMcpAuthContext, mcpAuthRoutes, requireMcpAuth } from '@sentropic/mcp-auth/hono';
import {
  createMcpSupervisor,
  type ClusterMeshHonoNamespaceModule,
} from '@sentropic/cluster-mesh';
import type {
  McpConnectorPort,
  McpHonoOptions,
  McpInvocation,
} from '../../../../packages/mcp-platform/src/hono';
import { createMcpPlatformHono } from '../../../../packages/mcp-platform/src/hono';
import { fromJwksPort } from '@sentropic/oauth-verify';

import { env } from '../../config/env';
import { createJwksAdapter } from '../../services/auth/jwks-adapter';
import { createGmailConnectorHost } from '../../services/connector-host/gmail';
import { createGoogleConnectorHost } from '../../services/connector-host/google-drive';
import { resolveDefaultWorkspaceId } from '../../services/workspace-access';
import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';
import { resolveOAuthIssuer } from '../auth/oauth';

const isEnabled = (): boolean => {
  const flag = process.env.MCP_RESOURCE_SERVER_ENABLED ?? env.MCP_RESOURCE_SERVER_ENABLED;
  return flag === 'true' || flag === '1';
};

let cachedMcp: McpAuth | null = null;

const getMcpAuth = (request?: Request): McpAuth => {
  if (cachedMcp) return cachedMcp;
  const issuer = resolveOAuthIssuer(request);
  const resource = env.MCP_RESOURCE_URI ?? `${issuer}/api/v1/mcp`;
  cachedMcp = createMcpAuth({
    resource,
    authorizationServers: [env.MCP_AUTHORIZATION_SERVER_URL ?? issuer],
    keySource: fromJwksPort(createJwksAdapter()),
    scopesSupported: [MCP_SCOPES.DISCOVER, MCP_SCOPES.RESOURCES_READ, MCP_SCOPES.TOOLS_INVOKE],
  });
  return cachedMcp;
};

const createAuthPort = (): McpHonoOptions['auth'] => {
  const auth = getMcpAuth();
  return {
    routes: mcpAuthRoutes(auth),
    require: (requiredScopes) => requireMcpAuth(auth, { requiredScopes }),
    context: (c) => {
      const value = getMcpAuthContext(c);
      return {
        sub: value.sub,
        clientId: value.clientId,
        tid: value.tid,
        scopes: value.scopes,
      };
    },
    scopes: {
      discover: MCP_SCOPES.DISCOVER,
      invoke: MCP_SCOPES.TOOLS_INVOKE,
      read: MCP_SCOPES.RESOURCES_READ,
    },
  };
};

const resolveDriver = async (request: McpInvocation) => {
  const workspaceId = request.workspaceRef
    ?? await resolveDefaultWorkspaceId(request.principal.sub)
    ?? '';
  const sessionUser = { userId: request.principal.sub, workspaceId };
  const driver = request.connectorId === 'google-drive'
    ? createGoogleConnectorHost({ sessionUser })
    : createGmailConnectorHost({ sessionUser });
  return {
    driver,
    request: {
      sessionPrincipalSub: request.principal.sub,
      requestedWorkspaceRef: request.workspaceRef,
      connectorId: request.connectorId,
      capabilityRef: request.capabilityRef,
      input: request.input,
      hints: request.accountSelectorHint
        ? { accountSelectorHint: request.accountSelectorHint }
        : undefined,
    },
  };
};

const connector: McpConnectorPort = {
  async invoke(request) {
    const resolved = await resolveDriver(request);
    return resolved.driver.invoke(resolved.request);
  },
  async readResource(request) {
    const resolved = await resolveDriver(request);
    return resolved.driver.readResource(resolved.request);
  },
};

export const productMcpPorts = { createAuthPort, connector, isEnabled };

const AUTHOR = 'cluster-mesh-mcp-module';
const control = clusterMeshAdapter.mcpControl;
if (!control) throw new Error('cluster mesh MCP control is not configured');
const supervisor = createMcpSupervisor({ store: control.store });
let activation: Promise<void> | undefined;

const ensureAuthor = async (): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/mcp' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow') {
    activation ??= (async () => {
      const evidence = {
        strategy: 'pre-deletion-shadow-suite',
        prmReadIntentRef: 'api/tests/api/mcp-resource-server.test.ts',
        deterministicProtocolRef: 'packages/mcp-platform/tests/hono.test.ts',
        providerEffectsDuplicated: false,
      };
      const shadow = {
        ...key,
        selectedGenerationId: control.runtime.generation.generationId,
        previousGenerationId: 'legacy-api-mcp-v1',
        activeAuthor: AUTHOR,
        status: 'shadow' as const,
        shadowComparison: evidence,
        rollbackCheckpoint: { generationId: 'legacy-api-mcp-v1', activeAuthor: 'legacy-api-mcp' },
      };
      await control.cutovers.activate(shadow);
      await control.cutovers.activate({
        ...shadow,
        status: 'active',
        activatedAt: new Date().toISOString(),
      });
    })().finally(() => { activation = undefined; });
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

const ensureSupervisor = async () => {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
  await control.store.saveGeneration({
    generationId: control.runtime.generation.generationId,
    status: 'active',
    supervisorRef: control.supervisorRef,
    supervisorLeaseExpiresAt: leaseExpiresAt,
    maxConcurrent: control.runtime.admission.maxConcurrent,
    poolSize: control.runtime.generation.config.capacity.poolSize,
  });
  const registered = await supervisor.register({
    serverId: control.serverId,
    generationId: control.runtime.generation.generationId,
    supervisorRef: control.supervisorRef,
    leaseExpiresAt,
  });
  if (!registered.ok) return registered;
  return supervisor.authorize(control.runtime.generation.generationId, control.supervisorRef);
};

export const productMcpModule: ClusterMeshHonoNamespaceModule = {
  namespace: '/mcp',
  enabled: true,
  createRouter() {
    return createMcpPlatformHono({
      auth: createAuthPort(),
      connector,
      enabled: isEnabled,
      invocation: {
        async authorize() {
          try {
            if (!await ensureAuthor()) return { allowed: false, reason: 'wrong_author', status: 503 };
            const registration = await ensureSupervisor();
            return registration.ok
              ? { allowed: true }
              : { allowed: false, reason: registration.reason, status: 503 };
          } catch {
            return { allowed: false, reason: 'mcp_control_unavailable', status: 503 };
          }
        },
      },
    });
  },
};
