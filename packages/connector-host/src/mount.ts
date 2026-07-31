import type {
  AppConnectorProviderAdapter,
  AppResourceRead,
  AppResourceResult,
  AppToolInvocation,
  AppToolResult,
  StpConnectorContext,
} from '../../mcp-platform/src/runtime.js';
import { listVisibleCapabilities } from '../../mcp-platform/src/visibility.js';
import type { VisibilityContext } from '../../mcp-platform/src/visibility.js';
import type { ConnectorTenantContext } from '../../mcp-platform/src/manifest.js';
import type {
  AccountResolution,
  ConnectorHostPorts,
  TenantWorkspaceResolution,
} from './ports.js';

export type ConnectorHostRequest = {
  sessionPrincipalSub: string;
  requestedWorkspaceRef?: string;
  connectorId: string;
  capabilityRef: string;
  input: unknown;
  hints?: Record<string, unknown>;
};

export type ConnectorHostExposurePolicy = {
  isCapabilityAllowed?(input: {
    capabilityRef: string;
    resolution: TenantWorkspaceResolution;
    request: ConnectorHostRequest;
  }): boolean;
};

export type ConnectorHostDriver = {
  invoke(request: ConnectorHostRequest): Promise<AppToolResult | string>;
  readResource(request: ConnectorHostRequest): Promise<AppResourceResult>;
};

export type ConnectorHostOptions = {
  adapters: Readonly<Record<string, AppConnectorProviderAdapter>>;
  ports: ConnectorHostPorts;
  exposurePolicy?: ConnectorHostExposurePolicy;
};

class ConnectorHostPrincipalMismatchError extends Error {
  constructor() {
    super('connector host refused a session principal mismatch');
    this.name = 'ConnectorHostPrincipalMismatchError';
  }
}

class ConnectorHostTenantBroadeningError extends Error {
  constructor() {
    super('connector host refused a broadened tenant context');
    this.name = 'ConnectorHostTenantBroadeningError';
  }
}

type MissingResult = {
  ok: false;
  auditId: string;
  redactionClass: 'none';
  error: { code: 'connector_not_found'; message: string; retriable: false };
};

function missingResult(): MissingResult {
  return {
    ok: false,
    auditId: 'connector-host-missing',
    redactionClass: 'none',
    error: {
      code: 'connector_not_found',
      message: 'Connector capability not found.',
      retriable: false,
    },
  };
}

function isDenied(value: unknown): value is { deny: true; reason: string } {
  return typeof value === 'object' && value !== null && (value as { deny?: unknown }).deny === true;
}

function containsPrincipalHint(hints: Record<string, unknown> | undefined): boolean {
  if (!hints) return false;
  return ['principal', 'principalRef', 'principalSub', 'sessionPrincipalSub', 'sub'].some((key) => key in hints);
}

function capabilityHintAllows(request: ConnectorHostRequest): boolean {
  const capabilityIds = request.hints?.capabilityIds;
  if (capabilityIds === undefined) return true;
  if (!Array.isArray(capabilityIds) || !capabilityIds.every((capabilityId) => typeof capabilityId === 'string')) {
    return false;
  }
  return capabilityIds.includes(request.capabilityRef);
}

function assertNarrowTenantContext(
  actual: ConnectorTenantContext,
  expected: { principalSub: string; tenantRef: string; workspaceRef: string; connectorInstanceId: string },
): void {
  if (
    actual.principalRef !== expected.principalSub
    || actual.tenantRef !== expected.tenantRef
    || actual.workspaceRef !== expected.workspaceRef
    || actual.connectorInstanceId !== expected.connectorInstanceId
  ) {
    throw new ConnectorHostTenantBroadeningError();
  }
}

function createHostContext(
  ports: ConnectorHostPorts,
  resolution: TenantWorkspaceResolution,
  account: AccountResolution,
): StpConnectorContext {
  const auditId = `connector-host:${account.enrollmentRef}`;
  const requestId = auditId;
  const principal = {
    sub: resolution.principalSub,
    claims: {},
    scopes: [],
    tenantRef: resolution.tenantRef,
    workspaceRef: resolution.workspaceRef,
    authTime: new Date(0).toISOString(),
  };

  return {
    requestId,
    correlationId: requestId,
    auditId,
    principal,
    surface: 'backend',
    session: { mcpSessionId: requestId },
    tenantRef: resolution.tenantRef,
    workspaceRef: resolution.workspaceRef,
    connectorInstanceId: account.connectorInstanceId,
    consentRefs: [],
    grantRefs: [],
    connectorConfig: {},
    audit: ports.audit,
    logger: { log: () => undefined },
    async getSecret(name: string): Promise<string> {
      try {
        const value = await ports.secret.resolve({
          connectorInstanceId: account.connectorInstanceId,
          secretName: name,
          principalSub: resolution.principalSub,
          workspaceRef: resolution.workspaceRef,
        });
        try {
          await ports.audit.emit({
            kind: 'secret.access',
            auditId,
            correlationId: requestId,
            at: new Date().toISOString(),
            detail: { name, result: 'granted' },
          });
        } catch {
          // Audit failure must not replace the port's raw secret result.
        }
        return value;
      } catch (error) {
        try {
          await ports.audit.emit({
            kind: 'secret.access',
            auditId,
            correlationId: requestId,
            at: new Date().toISOString(),
            detail: { name, result: 'denied' },
          });
        } catch {
          // Preserve the exact port failure for the adapter to classify by shape.
        }
        throw error;
      }
    },
  };
}

async function resolveInvocation(
  options: ConnectorHostOptions,
  request: ConnectorHostRequest,
): Promise<
  | { missing: true }
  | {
    adapter: AppConnectorProviderAdapter;
    ctx: StpConnectorContext;
    tenantContext: ConnectorTenantContext;
  }
> {
  const adapter = options.adapters[request.connectorId];
  if (!adapter || containsPrincipalHint(request.hints)) return { missing: true };

  const resolution = await options.ports.tenantWorkspace.resolve({
    sessionPrincipalSub: request.sessionPrincipalSub,
    requestedWorkspaceRef: request.requestedWorkspaceRef,
    hints: request.hints,
  });
  if (isDenied(resolution)) return { missing: true };

  // P1 structural guard: the resolver may never switch the authenticated principal.
  // Keep this explicit branch: the companion test is intentionally load-bearing.
  if (resolution.principalSub !== request.sessionPrincipalSub) {
    throw new ConnectorHostPrincipalMismatchError();
  }

  const allowlisted = resolution.exposure.capabilityIds.includes(request.capabilityRef);
  const allowedByCapabilityHint = capabilityHintAllows(request);
  const allowedByPolicy = options.exposurePolicy?.isCapabilityAllowed?.({
    capabilityRef: request.capabilityRef,
    resolution,
    request,
  }) ?? true;
  if (!allowlisted || !allowedByCapabilityHint || !allowedByPolicy) return { missing: true };

  const account = await options.ports.account.resolve({
    principalSub: resolution.principalSub,
    connectorId: request.connectorId,
    workspaceRef: resolution.workspaceRef,
    accountSelectorHint: typeof request.hints?.accountSelectorHint === 'string'
      ? request.hints.accountSelectorHint
      : undefined,
  });
  if (isDenied(account)) return { missing: true };

  const ctx = createHostContext(options.ports, resolution, account);

  const tenantContext = await adapter.resolveTenant({
    principalSub: resolution.principalSub,
    tenantRef: resolution.tenantRef,
    workspaceRef: resolution.workspaceRef,
    connectorInstanceId: account.connectorInstanceId,
    selectorHints: request.hints,
  });
  assertNarrowTenantContext(tenantContext, {
    principalSub: resolution.principalSub,
    tenantRef: resolution.tenantRef,
    workspaceRef: resolution.workspaceRef,
    connectorInstanceId: account.connectorInstanceId,
  });

  const visibility: VisibilityContext = {
    scopes: [],
    claims: [],
    tenantRef: resolution.tenantRef,
    accessibleTenants: [resolution.tenantRef],
  };
  const visible = listVisibleCapabilities(await adapter.listCapabilities(tenantContext), visibility);
  if (!visible.some((capability) => capability.name === request.capabilityRef)) return { missing: true };

  return { adapter, ctx, tenantContext };
}

/** Mount every adapter behind one per-workspace, deny-by-default request boundary. */
export function mountConnectorHost(options: ConnectorHostOptions): ConnectorHostDriver {
  return {
    async invoke(request): Promise<AppToolResult | string> {
      const resolved = await resolveInvocation(options, request);
      if ('missing' in resolved) return missingResult();
      const adapterRequest: AppToolInvocation = {
        capabilityRef: request.capabilityRef,
        input: request.input,
        ctx: resolved.ctx,
      };
      return resolved.adapter.invokeTool(adapterRequest);
    },

    async readResource(request): Promise<AppResourceResult> {
      const resolved = await resolveInvocation(options, request);
      if ('missing' in resolved) return missingResult();
      const input = request.input as { uri?: unknown };
      if (typeof input?.uri !== 'string') return missingResult();
      const adapterRequest: AppResourceRead = {
        capabilityRef: request.capabilityRef,
        input: { uri: input.uri },
        ctx: resolved.ctx,
      };
      return resolved.adapter.readResource(adapterRequest);
    },
  };
}
