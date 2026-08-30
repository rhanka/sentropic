import { createMcpAuth, MCP_SCOPES, type McpAuth } from '@sentropic/mcp-auth';
import { getMcpAuthContext, mcpAuthRoutes, requireMcpAuth } from '@sentropic/mcp-auth/hono';
import type {
  McpConnectorPort,
  McpHonoOptions,
  McpInvocation,
} from '@sentropic/mcp-platform/hono';
import { fromJwksPort } from '@sentropic/oauth-verify';

import { env } from '../../config/env';
import { createJwksAdapter } from '../../services/auth/jwks-adapter';
import { createGmailConnectorHost } from '../../services/connector-host/gmail';
import { createGoogleConnectorHost } from '../../services/connector-host/google-drive';
import { resolveDefaultWorkspaceId } from '../../services/workspace-access';
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
