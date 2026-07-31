import type { StpConnectorContext } from '../../mcp-platform/src/runtime.js';

export type SecretPortRequest = {
  connectorInstanceId: string;
  secretName: string;
  principalSub: string;
  workspaceRef: string;
};

/**
 * Resolves a single raw secret only inside the connector egress boundary.
 *
 * A success returns the raw value. A failure throws either a
 * SecretEnvelopeError-shaped value (`name`, safe `reason`, safe `version`) or
 * a SecretAccessError-shaped value (`name`, `reason`); this package neither
 * declares those error classes nor translates their codes.
 */
export interface SecretPort {
  resolve(ref: SecretPortRequest): Promise<string>;
}

export type AccountResolution = {
  connectorInstanceId: string;
  enrollmentRef: string;
  secretRefs: string[];
};

export type AccountResolutionDeny = { deny: true; reason: string };

export interface AccountResolver {
  resolve(input: {
    principalSub: string;
    connectorId: string;
    workspaceRef: string;
    accountSelectorHint?: string;
  }): Promise<AccountResolution | AccountResolutionDeny>;
}

export type TenantWorkspaceResolution = {
  principalSub: string;
  tenantRef: string;
  workspaceRef: string;
  exposure: { capabilityIds: string[] };
};

export type TenantWorkspaceResolutionDeny = { deny: true; reason: string };

/**
 * Server-side tenant/workspace resolver. `principalSub` MUST equal
 * `sessionPrincipalSub`; requested workspace and hints may only narrow the
 * server-side decision. Principal-bearing hints or a differing principal deny.
 */
export interface TenantWorkspaceResolver {
  resolve(input: {
    sessionPrincipalSub: string;
    requestedWorkspaceRef?: string;
    hints?: Record<string, unknown>;
  }): Promise<TenantWorkspaceResolution | TenantWorkspaceResolutionDeny>;
}

/** Reuses the platform context's name-only audit seam. */
export type AuditPort = Pick<StpConnectorContext['audit'], 'emit'>;

export type ConnectorHostPorts = {
  secret: SecretPort;
  account: AccountResolver;
  tenantWorkspace: TenantWorkspaceResolver;
  audit: AuditPort;
};
