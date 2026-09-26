/**
 * LLM gateway caller identity (SPEC_EVOL_LLM_DEPLOYABLE_PROCESS D4, BRDP-EX8; G1b deferred).
 *
 * Pure module: no database, environment or package import, so the product API and the standalone
 * host (`apps/llm-gateway`) compose it with the gateway's `ServiceAuthVerifyToken` /
 * `AuthHonoVerifyToken` `resolvePrincipal` callbacks. Those verifiers check signature, issuer,
 * audience, expiry, scopes and bound DPoP BEFORE any lookup here. Directory state is the only
 * authority: headers, body fields and token aliases never select a tenant, workspace or owner.
 *
 * Outcomes: `undefined` = identity refused (frozen provider-shaped 401); a thrown
 * `LlmIdentityUnavailableError` = directory outage (sanitized 503). Never allow on error.
 */

/** Service identity projected by the gateway `/auth` bridge after mcp-auth verification. */
export interface ServiceCallerIdentity {
  readonly kind: 'service';
  readonly issuer: string;
  readonly resource: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly jkt: string | null;
}

/** Session identity projected by the gateway `/auth-hono` bridge after session verification. */
export interface SessionCallerIdentity {
  readonly kind: 'session';
  readonly userId: string;
  readonly sessionId: string;
}

/** Structurally the gateway `VerifiedPrincipal`, with owner scope and workspace always set. */
export interface LlmVerifiedPrincipal {
  readonly tenantId: string;
  readonly principalId: string;
  readonly ownerScopeRef: string;
  readonly workspaceId: string;
  readonly source: string;
}

export interface UserWorkspaceGrant {
  readonly workspaceId: string;
  readonly workspaceTenantId: string;
  readonly workspaceHidden: boolean;
  /** `tenants.status` of the workspace tenant; null when the tenant row is missing. */
  readonly tenantStatus: string | null;
  /** The user's `tenant_memberships.status` in the workspace tenant; null when absent. */
  readonly tenantMembershipStatus: string | null;
}

export interface ServiceClientRecord {
  readonly clientId: string;
  readonly tenantId: string | null;
  readonly revoked: boolean;
  readonly dpopBound: boolean;
}

export interface WorkspaceTenantRecord {
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly hidden: boolean;
  readonly tenantStatus: string | null;
}

/** Read-only directory over existing stores; implementations must not cache revocations. */
export interface LlmIdentityDirectoryPort {
  listUserWorkspaceGrants(userId: string): Promise<readonly UserWorkspaceGrant[]>;
  findServiceClient(clientId: string): Promise<ServiceClientRecord | null>;
  findWorkspaceTenant(workspaceId: string): Promise<WorkspaceTenantRecord | null>;
}

/** Trusted server configuration: the workspace a service client acts in, within its tenant. */
export interface ServiceWorkspaceBinding {
  readonly clientId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
}

/** Plain trusted `ownerScopeRef` → `owner_user_id` mapping (D4/D7); no string-cast inference. */
export interface OwnerScopeMappingEntry {
  readonly ownerScopeRef: string;
  readonly ownerUserId: string;
}

export interface LlmCallerIdentityConfig {
  /** Expected issuer and resource (audience); compared again after verification. */
  readonly issuer: string;
  readonly resource: string;
  readonly source: string;
  readonly serviceBindings: readonly ServiceWorkspaceBinding[];
  readonly ownerMapping: readonly OwnerScopeMappingEntry[];
}

export class LlmIdentityUnavailableError extends Error {
  readonly code = 'llm_identity_unavailable';

  constructor() {
    super('LLM identity directory unavailable');
    this.name = 'LlmIdentityUnavailableError';
  }
}

export class LlmIdentityConfigError extends Error {
  readonly code = 'invalid_llm_identity_config';

  constructor(message: string) {
    super(message);
    this.name = 'LlmIdentityConfigError';
  }
}

const OWNER_SCOPE_REF = /^workspace:[^\s:]+:principal:\S+$/;

export const servicePrincipalId = (clientId: string): string => `service:${clientId}`;
export const ownerScopeRefFor = (workspaceId: string, principalId: string): string =>
  `workspace:${workspaceId}:principal:${principalId}`;

const text = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value !== '';
const trimIssuer = (value: string): string => value.replace(/\/+$/u, '');

const httpUrl = (field: string, value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LlmIdentityConfigError(`${field} must be an absolute HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new LlmIdentityConfigError(`${field} must be an absolute HTTP(S) URL`);
  }
  return value;
};

export interface TrustedOwnerMapping {
  ownerUserIdFor(ownerScopeRef: string): string | undefined;
  readonly size: number;
}

/** Validates the trusted mapping once; duplicate or malformed entries refuse the configuration. */
export const createTrustedOwnerMapping = (entries: readonly OwnerScopeMappingEntry[]): TrustedOwnerMapping => {
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (!text(entry?.ownerScopeRef) || !OWNER_SCOPE_REF.test(entry.ownerScopeRef) || !text(entry.ownerUserId)) {
      throw new LlmIdentityConfigError('owner mapping entries need a workspace/principal scope and an owner user id');
    }
    if (map.has(entry.ownerScopeRef)) {
      throw new LlmIdentityConfigError('owner mapping is ambiguous: duplicate ownerScopeRef');
    }
    map.set(entry.ownerScopeRef, entry.ownerUserId);
  }
  return { ownerUserIdFor: (ref) => map.get(ref), size: map.size };
};

const indexBindings = (bindings: readonly ServiceWorkspaceBinding[]): Map<string, ServiceWorkspaceBinding> => {
  const index = new Map<string, ServiceWorkspaceBinding>();
  for (const binding of bindings) {
    if (!text(binding?.clientId) || !text(binding.tenantId) || !text(binding.workspaceId)) {
      throw new LlmIdentityConfigError('service bindings need clientId, tenantId and workspaceId');
    }
    if (index.has(binding.clientId)) {
      throw new LlmIdentityConfigError('service bindings are ambiguous: duplicate clientId');
    }
    index.set(binding.clientId, Object.freeze({ ...binding }));
  }
  return index;
};

/** Any directory failure becomes one sanitized unavailable error (never an allow). */
const lookup = async <T>(read: () => Promise<T>): Promise<T> => {
  try {
    return await read();
  } catch {
    throw new LlmIdentityUnavailableError();
  }
};

export interface LlmCallerIdentity {
  readonly ownerMapping: TrustedOwnerMapping;
  resolveServicePrincipal(identity: ServiceCallerIdentity): Promise<LlmVerifiedPrincipal | undefined>;
  resolveSessionPrincipal(identity: SessionCallerIdentity): Promise<LlmVerifiedPrincipal | undefined>;
}

export const createLlmCallerIdentity = (options: {
  readonly directory: LlmIdentityDirectoryPort;
  readonly config: LlmCallerIdentityConfig;
}): LlmCallerIdentity => {
  const { directory, config } = options;
  const issuer = trimIssuer(httpUrl('issuer', config.issuer));
  const resource = httpUrl('resource', config.resource);
  if (!text(config.source)) throw new LlmIdentityConfigError('source is required');
  const bindings = indexBindings(config.serviceBindings);
  const ownerMapping = createTrustedOwnerMapping(config.ownerMapping);
  const source = config.source;

  return {
    ownerMapping,

    async resolveServicePrincipal(identity) {
      if (identity?.kind !== 'service' || !text(identity.clientId)) return undefined;
      if (trimIssuer(identity.issuer ?? '') !== issuer || identity.resource !== resource) return undefined;
      const binding = bindings.get(identity.clientId);
      if (!binding) return undefined;

      const client = await lookup(() => directory.findServiceClient(identity.clientId));
      if (!client || client.revoked || !client.tenantId || client.tenantId !== binding.tenantId) return undefined;
      if (client.dpopBound && !identity.jkt) return undefined;

      const workspace = await lookup(() => directory.findWorkspaceTenant(binding.workspaceId));
      if (!workspace || workspace.hidden || workspace.tenantStatus !== 'active'
        || workspace.tenantId !== client.tenantId) return undefined;

      const principalId = servicePrincipalId(identity.clientId);
      const ownerScopeRef = ownerScopeRefFor(binding.workspaceId, principalId);
      // A service principal never claims a user-owned seat scope.
      if (ownerMapping.ownerUserIdFor(ownerScopeRef) !== undefined) return undefined;
      return { tenantId: client.tenantId, principalId, ownerScopeRef, workspaceId: binding.workspaceId, source };
    },

    async resolveSessionPrincipal(identity) {
      if (identity?.kind !== 'session' || !text(identity.userId)) return undefined;
      const grants = await lookup(() => directory.listUserWorkspaceGrants(identity.userId));
      const eligible = new Map<string, string>();
      for (const grant of grants) {
        if (grant.workspaceHidden || grant.tenantStatus !== 'active' || grant.tenantMembershipStatus !== 'approved') continue;
        eligible.set(grant.workspaceId, grant.workspaceTenantId);
      }
      // No trusted workspace selection exists in the session context: only one eligible choice.
      if (eligible.size !== 1) return undefined;
      const [workspaceId, tenantId] = [...eligible][0]!;
      const ownerScopeRef = ownerScopeRefFor(workspaceId, identity.userId);
      const owner = ownerMapping.ownerUserIdFor(ownerScopeRef);
      if (owner !== undefined && owner !== identity.userId) return undefined;
      return { tenantId, principalId: identity.userId, ownerScopeRef, workspaceId, source };
    },
  };
};
