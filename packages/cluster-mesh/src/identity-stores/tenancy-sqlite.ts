// Identity core lot A2.2: SQLite backends for the tenant, membership,
// workspace and OAuth stores. `node:sqlite` only; the database handle is
// injected through a structural interface so `src` carries no driver import.

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
import { IDENTITY_A22_SQLITE_DDL } from './tenancy-schema.js';

export interface SqliteStoreStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { readonly changes: number | bigint };
}

export interface SqliteStoreDb {
  prepare(sql: string): SqliteStoreStatement;
  exec(sql: string): void;
}

export interface SqliteIdentityStores {
  readonly tenants: TenantRegistryStore;
  readonly memberships: TenantMembershipStore;
  readonly workspaces: WorkspaceDirectoryStore;
  readonly workspaceMembers: WorkspaceMembershipStore;
  readonly oauth: OAuthTenantStore;
}

const text = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Identity store read an unexpected non-string value');
  return value;
};

const optionalText = (value: unknown): string | undefined =>
  value === null || value === undefined ? undefined : text(value);

const rowOf = (value: unknown): Record<string, unknown> | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') throw new Error('Identity store read an unexpected row shape');
  return value as Record<string, unknown>;
};

const rowsOf = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value)) throw new Error('Identity store read an unexpected row set');
  return value.map((entry) => {
    const row = rowOf(entry);
    if (!row) throw new Error('Identity store read an unexpected null row');
    return row;
  });
};

const isUniqueViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as { code?: unknown; message?: unknown; errcode?: unknown };
  if (typeof record.code === 'string' && /CONSTRAINT|UNIQUE/i.test(record.code)) return true;
  if (
    typeof record.message === 'string' &&
    /UNIQUE constraint failed|PRIMARY KEY must be unique|CONSTRAINT/i.test(record.message)
  ) {
    return true;
  }
  // SQLITE_CONSTRAINT_PRIMARYKEY (1555) and SQLITE_CONSTRAINT_UNIQUE (2067).
  return record.errcode === 1555 || record.errcode === 2067;
};

const parseAliases = (value: unknown): readonly string[] => {
  if (typeof value !== 'string' || value === '') return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((entry): entry is string => typeof entry === 'string')) {
    throw new Error('Identity store read a malformed workspace alias list');
  }
  return parsed;
};

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

/** Applies the A2.2 DDL on the given database (idempotent). */
export function applySqliteIdentitySchema(db: SqliteStoreDb): void {
  db.exec(IDENTITY_A22_SQLITE_DDL);
}

export function createSqliteIdentityStores(db: SqliteStoreDb): SqliteIdentityStores {
  const findTenant = (tenantId: string): TenantRecord | null => {
    const row = rowOf(db.prepare('SELECT * FROM cm_tenants WHERE tenant_id = ?').get(tenantId));
    return row ? mapTenant(row) : null;
  };

  const findWorkspaceByRepoIdentity = (tenantId: string, repoIdentity: string): WorkspaceRecord | null => {
    const row = rowOf(
      db.prepare('SELECT * FROM cm_workspaces WHERE tenant_id = ? AND repo_identity = ?').get(tenantId, repoIdentity),
    );
    return row ? mapWorkspace(row) : null;
  };

  return {
    tenants: {
      async createTenant(record) {
        try {
          db.prepare('INSERT INTO cm_tenants (tenant_id, slug, status, created_at) VALUES (?, ?, ?, ?)').run(
            record.tenantId,
            record.slug,
            record.status,
            record.createdAt,
          );
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          if (db.prepare('SELECT * FROM cm_tenants WHERE slug = ?').get(record.slug)) {
            throw new IdentityConflictError('slug', `Tenant slug is taken: ${record.slug}`);
          }
          throw new IdentityConflictError('duplicate', `Tenant already exists: ${record.tenantId}`);
        }
      },
      async findTenant(tenantId) {
        return findTenant(tenantId);
      },
      async findTenantBySlug(slug) {
        const row = rowOf(db.prepare('SELECT * FROM cm_tenants WHERE slug = ?').get(slug));
        return row ? mapTenant(row) : null;
      },
      async listTenants() {
        return rowsOf(db.prepare('SELECT * FROM cm_tenants').all()).map(mapTenant);
      },
      async setTenantStatus(tenantId, status, _at) {
        const updated = db.prepare('UPDATE cm_tenants SET status = ? WHERE tenant_id = ?').run(status, tenantId);
        if (Number(updated.changes) === 0) throw new IdentityNotFoundError('tenant', tenantId);
        const tenant = findTenant(tenantId);
        if (!tenant) throw new IdentityNotFoundError('tenant', tenantId);
        return tenant;
      },
    } satisfies TenantRegistryStore,
    memberships: {
      async upsertMembershipRequest(record) {
        db.prepare(
          `INSERT INTO cm_tenant_memberships
             (user_id, tenant_id, status, tenant_role, decided_by, decided_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, tenant_id) DO UPDATE SET
             status = excluded.status, tenant_role = excluded.tenant_role,
             decided_by = excluded.decided_by, decided_at = excluded.decided_at,
             updated_at = excluded.updated_at`,
        ).run(
          record.userId,
          record.tenantId,
          record.status,
          record.tenantRole,
          record.decidedBy ?? null,
          record.decidedAt ?? null,
          record.updatedAt,
        );
        const row = rowOf(
          db.prepare('SELECT * FROM cm_tenant_memberships WHERE user_id = ? AND tenant_id = ?').get(
            record.userId,
            record.tenantId,
          ),
        );
        if (!row) throw new Error('Identity store lost a membership row after upsert');
        return mapMembership(row);
      },
      async findMembership(userId, tenantId) {
        const row = rowOf(
          db.prepare('SELECT * FROM cm_tenant_memberships WHERE user_id = ? AND tenant_id = ?').get(userId, tenantId),
        );
        return row ? mapMembership(row) : null;
      },
      async setMembershipState(userId, tenantId, state) {
        const updated = db
          .prepare(
            `UPDATE cm_tenant_memberships SET status = ?, tenant_role = ?, decided_by = ?,
             decided_at = ?, updated_at = ? WHERE user_id = ? AND tenant_id = ?`,
          )
          .run(state.status, state.tenantRole, state.decidedBy, state.decidedAt, state.updatedAt, userId, tenantId);
        if (Number(updated.changes) === 0) throw new IdentityNotFoundError('membership', `${userId}/${tenantId}`);
        const row = rowOf(
          db.prepare('SELECT * FROM cm_tenant_memberships WHERE user_id = ? AND tenant_id = ?').get(userId, tenantId),
        );
        if (!row) throw new IdentityNotFoundError('membership', `${userId}/${tenantId}`);
        return mapMembership(row);
      },
      async listMembershipsForTenant(tenantId) {
        return rowsOf(db.prepare('SELECT * FROM cm_tenant_memberships WHERE tenant_id = ?').all(tenantId)).map(
          mapMembership,
        );
      },
      async listMembershipsForUser(userId) {
        return rowsOf(db.prepare('SELECT * FROM cm_tenant_memberships WHERE user_id = ?').all(userId)).map(
          mapMembership,
        );
      },
      async findApprovedMembership(userId, tenantId) {
        const row = rowOf(
          db
            .prepare("SELECT * FROM cm_tenant_memberships WHERE user_id = ? AND tenant_id = ? AND status = 'approved'")
            .get(userId, tenantId),
        );
        return row ? mapMembership(row) : null;
      },
    } satisfies TenantMembershipStore,
    workspaces: {
      async enrolWorkspace(record) {
        try {
          db.prepare(
            'INSERT INTO cm_workspaces (workspace_id, tenant_id, repo_identity, aliases, enrolled_at) VALUES (?, ?, ?, ?, ?)',
          ).run(
            record.workspaceId,
            record.tenantId,
            record.repoIdentity,
            JSON.stringify(record.aliases),
            record.enrolledAt,
          );
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          if (record.repoIdentity !== null) {
            const sameRepo = findWorkspaceByRepoIdentity(record.tenantId, record.repoIdentity);
            if (sameRepo) throw new WorkspaceAlreadyEnrolledError(sameRepo.workspaceId);
          }
          throw new IdentityConflictError('duplicate', `Workspace exists: ${record.workspaceId}`);
        }
      },
      async findWorkspace(workspaceId) {
        const row = rowOf(db.prepare('SELECT * FROM cm_workspaces WHERE workspace_id = ?').get(workspaceId));
        return row ? mapWorkspace(row) : null;
      },
      async findWorkspaceByRepoIdentity(tenantId, repoIdentity) {
        return findWorkspaceByRepoIdentity(tenantId, repoIdentity);
      },
      async listWorkspacesForTenant(tenantId) {
        return rowsOf(db.prepare('SELECT * FROM cm_workspaces WHERE tenant_id = ?').all(tenantId)).map(mapWorkspace);
      },
      async approveWorkspaceAlias(workspaceId, alias) {
        const current = rowOf(db.prepare('SELECT * FROM cm_workspaces WHERE workspace_id = ?').get(workspaceId));
        if (!current) throw new IdentityNotFoundError('workspace', workspaceId);
        const aliases = mapWorkspace(current).aliases;
        const updated = aliases.includes(alias) ? aliases : [...aliases, alias];
        db.prepare('UPDATE cm_workspaces SET aliases = ? WHERE workspace_id = ?').run(
          JSON.stringify(updated),
          workspaceId,
        );
        const row = rowOf(db.prepare('SELECT * FROM cm_workspaces WHERE workspace_id = ?').get(workspaceId));
        if (!row) throw new IdentityNotFoundError('workspace', workspaceId);
        return mapWorkspace(row);
      },
    } satisfies WorkspaceDirectoryStore,
    workspaceMembers: {
      async putWorkspaceMember(record) {
        db.prepare(
          `INSERT INTO cm_workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)
           ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`,
        ).run(record.workspaceId, record.userId, record.role);
        const row = rowOf(
          db.prepare('SELECT * FROM cm_workspace_members WHERE workspace_id = ? AND user_id = ?').get(
            record.workspaceId,
            record.userId,
          ),
        );
        if (!row) throw new Error('Identity store lost a workspace member row after upsert');
        return mapWorkspaceMember(row);
      },
      async removeWorkspaceMember(workspaceId, userId) {
        const removed = db
          .prepare('DELETE FROM cm_workspace_members WHERE workspace_id = ? AND user_id = ?')
          .run(workspaceId, userId);
        return Number(removed.changes) > 0;
      },
      async findWorkspaceMember(workspaceId, userId) {
        const row = rowOf(
          db.prepare('SELECT * FROM cm_workspace_members WHERE workspace_id = ? AND user_id = ?').get(
            workspaceId,
            userId,
          ),
        );
        return row ? mapWorkspaceMember(row) : null;
      },
      async listWorkspaceMembers(workspaceId) {
        return rowsOf(db.prepare('SELECT * FROM cm_workspace_members WHERE workspace_id = ?').all(workspaceId)).map(
          mapWorkspaceMember,
        );
      },
    } satisfies WorkspaceMembershipStore,
    oauth: {
      async grantConsent(record: OAuthConsentRecord) {
        db.prepare(
          `INSERT INTO cm_oauth_consents (consent_id, tenant_id, user_id, client_id, granted_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, NULL)
           ON CONFLICT (consent_id) DO UPDATE SET
             tenant_id = excluded.tenant_id, user_id = excluded.user_id,
             client_id = excluded.client_id, granted_at = excluded.granted_at, revoked_at = NULL`,
        ).run(record.consentId, record.tenantId, record.userId, record.clientId, record.grantedAt);
      },
      async revokeConsent(consentId, at) {
        const revoked = db.prepare('UPDATE cm_oauth_consents SET revoked_at = ? WHERE consent_id = ?').run(
          at,
          consentId,
        );
        return Number(revoked.changes) > 0;
      },
      async bindServiceClient(record: ServiceClientBinding) {
        db.prepare(
          `INSERT INTO cm_service_clients (client_id, tenant_id, bound_at) VALUES (?, ?, ?)
           ON CONFLICT (client_id) DO UPDATE SET tenant_id = excluded.tenant_id, bound_at = excluded.bound_at`,
        ).run(record.clientId, record.tenantId, record.boundAt);
      },
      async listTenantServiceClients(tenantId) {
        return rowsOf(db.prepare('SELECT * FROM cm_service_clients WHERE tenant_id = ?').all(tenantId)).map(
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
