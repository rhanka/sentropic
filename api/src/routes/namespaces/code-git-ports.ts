import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { workspaces } from '../../db/schema';
import type { WorkspaceRole } from '../../services/workspace-access';
import { resolveOAuthIssuer } from '../auth/oauth';
import {
  findCmUserById,
} from '../../services/identity/cm-users';
import {
  findCmMembership,
  findCmTenant,
  findCmWorkspace,
  findCmWorkspaceMember,
  listCmTenants,
} from '../../services/identity/cm-tenancy';
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
 *   - Principal must have an allowed role (at least 'editor') in the CM workspace members.
 *   - serverIssuer must match the resolved OAuth issuer for the deployment.
 *   - bindingRevision must be an integer >= 1.
 * - Read-only: CM workspace members, tenant memberships, and connectorTenantEnrollments remain strictly invariant.
 *
 * Lot A4: tenant/user/membership/workspace-enrolment reads go through the CM
 * identity stores; only the business `workspaces` row is read from the app DB.
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

    // The binding `tenant` may be the CM tenant id or its slug (tid).
    const tenantRow =
      (await findCmTenant(tenant)) ??
      (await listCmTenants()).find((t) => t.slug === tenant) ??
      null;

    if (!tenantRow || tenantRow.status !== 'active') {
      throw new Error(`tenant "${tenant}" is not active or does not exist`);
    }

    const userRow = await findCmUserById(principal);

    if (!userRow || userRow.accountStatus !== 'active' || userRow.disabledAt !== null) {
      throw new Error(`principal "${principal}" is not active or disabled`);
    }

    const tenantMembership = await findCmMembership(principal, tenantRow.tenantId);

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
        hiddenAt: workspaces.hiddenAt,
      })
      .from(workspaces)
      .where(eq(workspaces.id, serverWorkspaceId))
      .limit(1);

    // Lot A4: the workspace -> tenant binding lives in the CM workspace directory.
    const cmWorkspace = await findCmWorkspace(serverWorkspaceId);

    if (!wsRow || wsRow.hiddenAt !== null || !cmWorkspace || cmWorkspace.tenantId !== tenantRow.tenantId) {
      throw new Error(
        `workspace "${serverWorkspaceId}" not found or hidden in tenant "${tenant}"`,
      );
    }

    if (wsRow.type !== 'code') {
      throw new Error(
        `workspace "${serverWorkspaceId}" is of type "${wsRow.type}": live Git indexing requires a code workspace`,
      );
    }

    const membership = await findCmWorkspaceMember(serverWorkspaceId, principal);

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
