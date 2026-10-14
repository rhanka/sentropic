import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  tenantMemberships,
  tenants,
  users,
  workspaceMemberships,
  workspaces,
} from '../../db/schema';
import type { WorkspaceRole } from '../../services/workspace-access';
import { resolveOAuthIssuer } from '../auth/oauth';
import type {
  LiveProductBindingAuthorizationInput,
  LiveProductBindingAuthorizationPort,
} from '../../../../packages/cluster-mesh/src/live-storage/registration';

export interface CodeWorkspaceBindingAuthorizerOptions {
  readonly database?: typeof db;
  readonly resolveIssuer?: () => string;
}

/**
 * Validates product code-workspace bindings for live Git indexing (L6a, B1/M7/N1/m1).
 *
 * Invariants & guardrails:
 * - Tenant must exist and have status 'active'.
 * - Principal user must exist, have accountStatus 'active', and disabledAt IS NULL.
 * - Principal must have an approved tenant membership in the tenant.
 * - When bound to a workspace:
 *   - Workspace must exist in the tenant, have hiddenAt IS NULL, and have type === 'code'.
 *   - Principal must have an allowed role (at least 'editor') in workspaceMemberships.
 *   - serverIssuer must match the resolved OAuth issuer for the deployment.
 *   - bindingRevision must be an integer >= 1.
 * - Read-only: workspaceMemberships, tenantMemberships, and connectorTenantEnrollments remain strictly invariant.
 */
export class DatabaseCodeWorkspaceBindingAuthorizer implements LiveProductBindingAuthorizationPort {
  private readonly database: typeof db;
  private readonly resolveIssuer: () => string;

  constructor(options: CodeWorkspaceBindingAuthorizerOptions = {}) {
    this.database = options.database ?? db;
    this.resolveIssuer = options.resolveIssuer ?? (() => resolveOAuthIssuer());
  }

  async authorizeProductBinding(input: LiveProductBindingAuthorizationInput): Promise<void> {
    const { tenant, principal, serverWorkspaceId, serverIssuer, bindingRevision } = input;

    const [tenantRow] = await this.database
      .select({ id: tenants.id, status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, tenant))
      .limit(1);

    if (!tenantRow || tenantRow.status !== 'active') {
      throw new Error(`tenant "${tenant}" is not active or does not exist`);
    }

    const [userRow] = await this.database
      .select({
        id: users.id,
        accountStatus: users.accountStatus,
        disabledAt: users.disabledAt,
      })
      .from(users)
      .where(eq(users.id, principal))
      .limit(1);

    if (!userRow || userRow.accountStatus !== 'active' || userRow.disabledAt !== null) {
      throw new Error(`principal "${principal}" is not active or disabled`);
    }

    const [tenantMembership] = await this.database
      .select({ status: tenantMemberships.status })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, tenant),
          eq(tenantMemberships.userId, principal),
        ),
      )
      .limit(1);

    if (!tenantMembership || tenantMembership.status !== 'approved') {
      throw new Error(
        `principal "${principal}" is not an approved member of tenant "${tenant}"`,
      );
    }

    if (!serverWorkspaceId) {
      return;
    }

    if (!bindingRevision || bindingRevision < 1) {
      throw new Error(`invalid bindingRevision: must be an integer >= 1, received ${bindingRevision}`);
    }

    const expectedIssuer = this.resolveIssuer();
    if (serverIssuer !== expectedIssuer) {
      throw new Error(
        `serverIssuer mismatch: expected "${expectedIssuer}", received "${serverIssuer}"`,
      );
    }

    const [wsRow] = await this.database
      .select({
        id: workspaces.id,
        type: workspaces.type,
        tenantId: workspaces.tenantId,
        hiddenAt: workspaces.hiddenAt,
      })
      .from(workspaces)
      .where(and(eq(workspaces.id, serverWorkspaceId), eq(workspaces.tenantId, tenant)))
      .limit(1);

    if (!wsRow || wsRow.hiddenAt !== null) {
      throw new Error(
        `workspace "${serverWorkspaceId}" not found or hidden in tenant "${tenant}"`,
      );
    }

    if (wsRow.type !== 'code') {
      throw new Error(
        `workspace "${serverWorkspaceId}" is of type "${wsRow.type}": live Git indexing requires a code workspace`,
      );
    }

    const [membership] = await this.database
      .select({ role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, serverWorkspaceId),
          eq(workspaceMemberships.userId, principal),
        ),
      )
      .limit(1);

    if (!membership) {
      throw new Error(
        `principal "${principal}" is not an authorized member of workspace "${serverWorkspaceId}"`,
      );
    }

    const role = membership.role as WorkspaceRole;
    if (role !== 'editor' && role !== 'admin') {
      throw new Error(
        `principal "${principal}" has role "${role}" in workspace "${serverWorkspaceId}": live Git indexing requires at least editor role`,
      );
    }
  }
}

export const defaultCodeWorkspaceBindingAuthorizer = new DatabaseCodeWorkspaceBindingAuthorizer();
