// Identity core lot A2.2: PostgreSQL backends for the tenant, membership,
// workspace and OAuth stores. The driver stays injected through a minimal
// query interface so `src` never depends on `pg`; tests supply a pool client.

import { IdentityNotFoundError, WorkspaceAlreadyEnrolledError } from '../identity-contracts/errors.js';
import { IdentityConflictError } from '../identity-contracts/errors.js';
import type {
  OAuthTenantStore,
  TenantMembershipStore,
  TenantRegistryStore,
  WorkspaceDirectoryStore,
  WorkspaceMembershipStore,
} from '../identity-contracts/ports.js';
import type {
  OAuthConsentRecord,
  ServiceClientBinding,
  TenantMembershipRecord,
  TenantRecord,
  TenantStatus,
  WorkspaceMembershipRecord,
  WorkspaceRecord,
} from '../identity-contracts/types.js';
import { identityA22PostgresDdl } from './tenancy-schema.js';

export interface PostgresStoreClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[]; readonly rowCount?: number | null }>;
}

export interface PostgresIdentityStoreOptions {
  /** Qualifies every table (`"schema".cm_*`); used for per-test isolation. */
  readonly schema?: string;
}

const ident = (schema: string | undefined, table: string): string =>
  schema ? `"${schema}"."${table}"` : `"${table}"`;

const text = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Identity store read an unexpected non-string value');
  return value;
};

const optionalText = (value: unknown): string | undefined =>
  value === null || value === undefined ? undefined : text(value);

const parseAliases = (value: unknown): readonly string[] => {
  if (typeof value !== 'string' || value === '') return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((entry): entry is string => typeof entry === 'string')) {
    throw new Error('Identity store read a malformed workspace alias list');
  }
  return parsed;
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

const mapTenant = (row: Record<string, unknown>): TenantRecord => ({
  tenantId: text(row['tenant_id']),
  slug: text(row['slug']),
  status: text(row['status']) as TenantStatus,
  createdAt: text(row['created_at']),
});

const mapMembership = (row: Record<string, unknown>): TenantMembershipRecord => ({
  userId: text(row['user_id']),
  tenantId: text(row['tenant_id']),
  status: text(row['status']) as TenantMembershipRecord['status'],
  tenantRole: text(row['tenant_role']) as TenantMembershipRecord['tenantRole'],
  decidedBy: optionalText(row['decided_by']),
  decidedAt: optionalText(row['decided_at']),
  updatedAt: text(row['updated_at']),
});

const mapWorkspace = (row: Record<string, unknown>): WorkspaceRecord => ({
  workspaceId: text(row['workspace_id']),
  tenantId: text(row['tenant_id']),
  repoIdentity: (row['repo_identity'] as string | null) ?? null,
  aliases: parseAliases(row['aliases']),
  enrolledAt: text(row['enrolled_at']),
});

const mapWorkspaceMember = (row: Record<string, unknown>): WorkspaceMembershipRecord => ({
  workspaceId: text(row['workspace_id']),
  userId: text(row['user_id']),
  role: text(row['role']) as WorkspaceMembershipRecord['role'],
});

export interface PostgresIdentityStores {
  readonly tenants: TenantRegistryStore;
  readonly memberships: TenantMembershipStore;
  readonly workspaces: WorkspaceDirectoryStore;
  readonly workspaceMembers: WorkspaceMembershipStore;
  readonly oauth: OAuthTenantStore;
}

/** Applies the A2.2 DDL on the given client (idempotent). */
export async function applyPostgresIdentitySchema(
  client: PostgresStoreClient,
  options?: PostgresIdentityStoreOptions,
): Promise<void> {
  await client.query(identityA22PostgresDdl(options?.schema));
}

export function createPostgresIdentityStores(
  client: PostgresStoreClient,
  options?: PostgresIdentityStoreOptions,
): PostgresIdentityStores {
  const schema = options?.schema;
  if (schema !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(`Invalid identity schema: ${schema}`);
  }
  const tenants = ident(schema, 'cm_tenants');
  const memberships = ident(schema, 'cm_tenant_memberships');
  const workspaces = ident(schema, 'cm_workspaces');
  const members = ident(schema, 'cm_workspace_members');
  const consents = ident(schema, 'cm_oauth_consents');
  const serviceClients = ident(schema, 'cm_service_clients');

  const findTenant = async (tenantId: string): Promise<TenantRecord | null> => {
    const result = await client.query(`SELECT * FROM ${tenants} WHERE tenant_id = $1`, [tenantId]);
    const row = result.rows[0];
    return row ? mapTenant(row) : null;
  };

  const findWorkspaceByRepoIdentity = async (
    tenantId: string,
    repoIdentity: string,
  ): Promise<WorkspaceRecord | null> => {
    const result = await client.query(`SELECT * FROM ${workspaces} WHERE tenant_id = $1 AND repo_identity = $2`, [
      tenantId,
      repoIdentity,
    ]);
    const row = result.rows[0];
    return row ? mapWorkspace(row) : null;
  };

  return {
    tenants: {
      async createTenant(record) {
        try {
          await client.query(
            `INSERT INTO ${tenants} (tenant_id, slug, status, created_at) VALUES ($1, $2, $3, $4)`,
            [record.tenantId, record.slug, record.status, record.createdAt],
          );
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          const bySlug = await client.query(`SELECT * FROM ${tenants} WHERE slug = $1`, [record.slug]);
          if (bySlug.rows[0]) throw new IdentityConflictError('slug', `Tenant slug is taken: ${record.slug}`);
          throw new IdentityConflictError('duplicate', `Tenant already exists: ${record.tenantId}`);
        }
      },
      findTenant,
      async findTenantBySlug(slug) {
        const result = await client.query(`SELECT * FROM ${tenants} WHERE slug = $1`, [slug]);
        const row = result.rows[0];
        return row ? mapTenant(row) : null;
      },
      async listTenants() {
        const result = await client.query(`SELECT * FROM ${tenants}`);
        return result.rows.map(mapTenant);
      },
      async setTenantStatus(tenantId, status, at) {
        const result = await client.query(
          `UPDATE ${tenants} SET status = $2 WHERE tenant_id = $1 RETURNING *`,
          [tenantId, status],
        );
        const row = result.rows[0];
        if (!row) throw new IdentityNotFoundError('tenant', tenantId);
        void at;
        return mapTenant(row);
      },
    } satisfies TenantRegistryStore,
    memberships: {
      async upsertMembershipRequest(record) {
        const result = await client.query(
          `INSERT INTO ${memberships}
             (user_id, tenant_id, status, tenant_role, decided_by, decided_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, tenant_id) DO UPDATE SET
             status = EXCLUDED.status, tenant_role = EXCLUDED.tenant_role,
             decided_by = EXCLUDED.decided_by, decided_at = EXCLUDED.decided_at,
             updated_at = EXCLUDED.updated_at
           RETURNING *`,
          [
            record.userId,
            record.tenantId,
            record.status,
            record.tenantRole,
            record.decidedBy ?? null,
            record.decidedAt ?? null,
            record.updatedAt,
          ],
        );
        return mapMembership(result.rows[0] as Record<string, unknown>);
      },
      async findMembership(userId, tenantId) {
        const result = await client.query(`SELECT * FROM ${memberships} WHERE user_id = $1 AND tenant_id = $2`, [
          userId,
          tenantId,
        ]);
        const row = result.rows[0];
        return row ? mapMembership(row) : null;
      },
      async setMembershipState(userId, tenantId, state) {
        const result = await client.query(
          `UPDATE ${memberships} SET status = $3, tenant_role = $4, decided_by = $5, decided_at = $6, updated_at = $7
           WHERE user_id = $1 AND tenant_id = $2 RETURNING *`,
          [userId, tenantId, state.status, state.tenantRole, state.decidedBy, state.decidedAt, state.updatedAt],
        );
        const row = result.rows[0];
        if (!row) throw new IdentityNotFoundError('membership', `${userId}/${tenantId}`);
        return mapMembership(row);
      },
      async listMembershipsForTenant(tenantId) {
        const result = await client.query(`SELECT * FROM ${memberships} WHERE tenant_id = $1`, [tenantId]);
        return result.rows.map(mapMembership);
      },
      async listMembershipsForUser(userId) {
        const result = await client.query(`SELECT * FROM ${memberships} WHERE user_id = $1`, [userId]);
        return result.rows.map(mapMembership);
      },
      async findApprovedMembership(userId, tenantId) {
        const result = await client.query(
          `SELECT * FROM ${memberships} WHERE user_id = $1 AND tenant_id = $2 AND status = 'approved'`,
          [userId, tenantId],
        );
        const row = result.rows[0];
        return row ? mapMembership(row) : null;
      },
    } satisfies TenantMembershipStore,
    workspaces: {
      async enrolWorkspace(record) {
        try {
          await client.query(
            `INSERT INTO ${workspaces} (workspace_id, tenant_id, repo_identity, aliases, enrolled_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [record.workspaceId, record.tenantId, record.repoIdentity, JSON.stringify(record.aliases), record.enrolledAt],
          );
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          if (record.repoIdentity !== null) {
            const sameRepo = await findWorkspaceByRepoIdentity(record.tenantId, record.repoIdentity);
            if (sameRepo) throw new WorkspaceAlreadyEnrolledError(sameRepo.workspaceId);
          }
          throw new IdentityConflictError('duplicate', `Workspace exists: ${record.workspaceId}`);
        }
      },
      async findWorkspace(workspaceId) {
        const result = await client.query(`SELECT * FROM ${workspaces} WHERE workspace_id = $1`, [workspaceId]);
        const row = result.rows[0];
        return row ? mapWorkspace(row) : null;
      },
      findWorkspaceByRepoIdentity,
      async listWorkspacesForTenant(tenantId) {
        const result = await client.query(`SELECT * FROM ${workspaces} WHERE tenant_id = $1`, [tenantId]);
        return result.rows.map(mapWorkspace);
      },
      async approveWorkspaceAlias(workspaceId, alias) {
        const current = await client.query(`SELECT * FROM ${workspaces} WHERE workspace_id = $1`, [workspaceId]);
        const row = current.rows[0];
        if (!row) throw new IdentityNotFoundError('workspace', workspaceId);
        const aliases = mapWorkspace(row).aliases;
        const updated = aliases.includes(alias) ? aliases : [...aliases, alias];
        const result = await client.query(`UPDATE ${workspaces} SET aliases = $2 WHERE workspace_id = $1 RETURNING *`, [
          workspaceId,
          JSON.stringify(updated),
        ]);
        return mapWorkspace(result.rows[0] as Record<string, unknown>);
      },
    } satisfies WorkspaceDirectoryStore,
    workspaceMembers: {
      async putWorkspaceMember(record) {
        const result = await client.query(
          `INSERT INTO ${members} (workspace_id, user_id, role) VALUES ($1, $2, $3)
           ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
           RETURNING *`,
          [record.workspaceId, record.userId, record.role],
        );
        return mapWorkspaceMember(result.rows[0] as Record<string, unknown>);
      },
      async removeWorkspaceMember(workspaceId, userId) {
        const result = await client.query(`DELETE FROM ${members} WHERE workspace_id = $1 AND user_id = $2`, [
          workspaceId,
          userId,
        ]);
        return (result.rowCount ?? 0) > 0;
      },
      async findWorkspaceMember(workspaceId, userId) {
        const result = await client.query(`SELECT * FROM ${members} WHERE workspace_id = $1 AND user_id = $2`, [
          workspaceId,
          userId,
        ]);
        const row = result.rows[0];
        return row ? mapWorkspaceMember(row) : null;
      },
      async listWorkspaceMembers(workspaceId) {
        const result = await client.query(`SELECT * FROM ${members} WHERE workspace_id = $1`, [workspaceId]);
        return result.rows.map(mapWorkspaceMember);
      },
    } satisfies WorkspaceMembershipStore,
    oauth: {
      async grantConsent(record: OAuthConsentRecord) {
        await client.query(
          `INSERT INTO ${consents} (consent_id, tenant_id, user_id, client_id, granted_at, revoked_at)
           VALUES ($1, $2, $3, $4, $5, NULL)
           ON CONFLICT (consent_id) DO UPDATE SET
             tenant_id = EXCLUDED.tenant_id, user_id = EXCLUDED.user_id,
             client_id = EXCLUDED.client_id, granted_at = EXCLUDED.granted_at, revoked_at = NULL`,
          [record.consentId, record.tenantId, record.userId, record.clientId, record.grantedAt],
        );
      },
      async revokeConsent(consentId, at) {
        const result = await client.query(`UPDATE ${consents} SET revoked_at = $2 WHERE consent_id = $1`, [
          consentId,
          at,
        ]);
        return (result.rowCount ?? 0) > 0;
      },
      async bindServiceClient(record: ServiceClientBinding) {
        await client.query(
          `INSERT INTO ${serviceClients} (client_id, tenant_id, bound_at) VALUES ($1, $2, $3)
           ON CONFLICT (client_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, bound_at = EXCLUDED.bound_at`,
          [record.clientId, record.tenantId, record.boundAt],
        );
      },
      async listTenantServiceClients(tenantId) {
        const result = await client.query(`SELECT * FROM ${serviceClients} WHERE tenant_id = $1`, [tenantId]);
        return result.rows.map(
          (row): ServiceClientBinding => ({
            clientId: text(row['client_id']),
            tenantId: text(row['tenant_id']),
            boundAt: text(row['bound_at']),
          }),
        );
      },
    } satisfies OAuthTenantStore,
  };
}
