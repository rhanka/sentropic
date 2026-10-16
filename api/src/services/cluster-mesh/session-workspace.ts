import { and, eq } from 'drizzle-orm';
import {
  createSessionWorkspaceBindingService,
  SessionWorkspaceBindingError,
  type SessionWorkspaceBinding,
  type SessionWorkspaceBindingStore,
} from '@sentropic/cluster-mesh';
import { db } from '../../db/client';
import { sessionWorkspaceBindings } from '../../db/control-schema';
import { tenantMemberships, users, workspaces } from '../../db/schema';
import { hasRole } from '../../middleware/rbac';
import { hasWorkspaceRole, type WorkspaceType } from '../workspace-access';
import { SessionContentService } from './session-content';
import { notifyWorkspaceCreated, provisionWorkspace, seedWorkspaceTypeResources } from '../workspace-provisioning';

export type AdoptedSessionWorkspaceStatus = 'attached' | 'detached' | 'ended';

export interface AdoptSessionWorkspaceInput {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly principalId: string;
  readonly workspaceId?: string;
  readonly create?: { readonly name: string; readonly type?: string };
}

export interface AdoptedSessionWorkspace {
  readonly bindingId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly principalId?: string;
  readonly status: AdoptedSessionWorkspaceStatus;
  readonly version: number;
}

export type SessionWorkspaceErrorCode =
  | 'invalid_request' | 'workspace_not_found' | 'cross_tenant_refused' | 'workspace_rights_refused'
  | 'session_already_attached' | 'session_not_attached' | 'session_ended' | 'binding_not_found';

export class SessionWorkspaceError extends Error {
  constructor(readonly code: SessionWorkspaceErrorCode, message: string) {
    super(message);
    this.name = 'SessionWorkspaceError';
  }
}
type BindingRow = typeof sessionWorkspaceBindings.$inferSelect;
type BindingDbClient = Pick<typeof db, 'select' | 'insert' | 'update'>;
const requireId = (value: string | undefined, field: string): string => {
  if (!value?.trim()) throw new SessionWorkspaceError('invalid_request', `${field} is required`);
  return value;
};
const toRecord = (b: SessionWorkspaceBinding | BindingRow): AdoptedSessionWorkspace => ({
  bindingId: b.bindingId, sessionId: b.sessionId, workspaceId: b.workspaceId,
  tenantId: b.tenantId, principalId: b.principalId ?? undefined,
  status: b.status as AdoptedSessionWorkspaceStatus,
  version: b.version,
});
const toRow = (b: SessionWorkspaceBinding) => ({
  bindingId: b.bindingId, sessionId: b.sessionId, workspaceId: b.workspaceId,
  tenantId: b.tenantId, principalId: b.principalId, status: b.status,
  version: b.version,
  createdAt: new Date(b.createdAt), updatedAt: new Date(b.updatedAt),
  detachedAt: b.detachedAt ? new Date(b.detachedAt) : null,
  endedAt: b.endedAt ? new Date(b.endedAt) : null,
});

const toBinding = (row: BindingRow): SessionWorkspaceBinding => ({
  bindingId: row.bindingId, sessionId: row.sessionId, workspaceId: row.workspaceId,
  tenantId: row.tenantId, principalId: row.principalId,
  status: row.status as SessionWorkspaceBinding['status'],
  version: row.version,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  detachedAt: row.detachedAt ? row.detachedAt.toISOString() : undefined,
  endedAt: row.endedAt ? row.endedAt.toISOString() : undefined,
});

export interface DrizzleBindingStoreHooks {
  beforeCompareAndSet?: (current: SessionWorkspaceBinding | null, next: SessionWorkspaceBinding) => Promise<void>;
}

export const createDrizzleBindingStore = (
  client: BindingDbClient,
  hooks?: DrizzleBindingStoreHooks,
): SessionWorkspaceBindingStore => ({
  async findBySession(sessionId: string): Promise<SessionWorkspaceBinding | null> {
    const [row] = await client.select().from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, sessionId)).limit(1);
    return row ? toBinding(row) : null;
  },
  async compareAndSet(
    current: SessionWorkspaceBinding | null,
    next: SessionWorkspaceBinding,
  ): Promise<boolean> {
    if (hooks?.beforeCompareAndSet) {
      await hooks.beforeCompareAndSet(current, next);
    }
    if (current === null) {
      const inserted = await client.insert(sessionWorkspaceBindings).values(toRow(next))
        .onConflictDoNothing()
        .returning({ bindingId: sessionWorkspaceBindings.bindingId });
      return inserted.length > 0;
    }
    const updated = await client.update(sessionWorkspaceBindings).set({
      workspaceId: next.workspaceId, tenantId: next.tenantId, principalId: next.principalId,
      status: next.status, version: next.version, updatedAt: new Date(next.updatedAt),
      detachedAt: next.detachedAt ? new Date(next.detachedAt) : null,
      endedAt: next.endedAt ? new Date(next.endedAt) : null,
    }).where(and(
      eq(sessionWorkspaceBindings.sessionId, next.sessionId),
      eq(sessionWorkspaceBindings.version, current.version),
      eq(sessionWorkspaceBindings.status, current.status),
      eq(sessionWorkspaceBindings.workspaceId, current.workspaceId),
      eq(sessionWorkspaceBindings.principalId, current.principalId),
    )).returning({ bindingId: sessionWorkspaceBindings.bindingId });
    return updated.length > 0;
  },
});

export interface SessionWorkspaceContentHooks {
  fenceSessionOnDetachEnd(sessionId: string, tenantId: string): Promise<unknown>;
}

export class SessionWorkspaceService {
  private readonly storeFactory: (client: BindingDbClient) => SessionWorkspaceBindingStore;
  private readonly mesh: ReturnType<typeof createSessionWorkspaceBindingService>;
  private readonly contentHooks: SessionWorkspaceContentHooks | null;

  constructor(
    storeFactory: (client: BindingDbClient) => SessionWorkspaceBindingStore = createDrizzleBindingStore,
    contentHooks?: SessionWorkspaceContentHooks | null,
  ) {
    this.storeFactory = storeFactory;
    this.mesh = createSessionWorkspaceBindingService(storeFactory(db));
    if (contentHooks === undefined) {
      this.contentHooks = new SessionContentService({ issuer: 'sentropic-product' });
    } else {
      this.contentHooks = contentHooks;
    }
  }

  private async fenceContent(sessionId: string, tenantId: string): Promise<void> {
    if (!this.contentHooks) return;
    try {
      await this.contentHooks.fenceSessionOnDetachEnd(sessionId, tenantId);
    } catch (err) {
      console.error('Failed to fence session content on detach/end', sessionId, err);
    }
  }

  private async checkTenantMember(tenantId: string, principalId: string): Promise<void> {
    const [membership] = await db.select({ status: tenantMemberships.status }).from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, principalId))).limit(1);
    if (membership?.status !== 'approved') {
      throw new SessionWorkspaceError('workspace_rights_refused', 'principal is not an approved member of the tenant');
    }
  }

  private async checkIsAdmin(
    tenantId: string, principalId: string, workspaceId: string, client: BindingDbClient = db,
  ): Promise<boolean> {
    const [tMember] = await client.select({ role: tenantMemberships.role, status: tenantMemberships.status }).from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, principalId))).limit(1);
    if (tMember?.status === 'approved' && tMember.role === 'admin') return true;
    if (workspaceId) return await hasWorkspaceRole(principalId, workspaceId, 'admin', client);
    return false;
  }

  /**
   * Global creation guard, mirroring the canonical route's `requireEditor`
   * middleware (same role levels: admin_app/admin_org/editor pass, guest fails).
   * Returns the caller's global role for seeding.
   */
  private async requireGlobalEditor(principalId: string): Promise<string> {
    const [row] = await db.select({ role: users.role }).from(users)
      .where(eq(users.id, principalId)).limit(1);
    const role = row?.role ?? 'guest';
    if (!hasRole(role, 'editor')) {
      throw new SessionWorkspaceError('workspace_rights_refused', 'global editor role required to create a workspace');
    }
    return role;
  }

  /**
   * Post-commit seeds for an adopted workspace: workflows/agents and view
   * templates for the type. Failures are non-fatal, exactly like the route.
   */
  private async seedCreatedWorkspace(
    principalId: string, globalRole: string, workspaceId: string, type: WorkspaceType,
  ): Promise<void> {
    await seedWorkspaceTypeResources(
      { userId: principalId, role: globalRole, workspaceId, type },
    );
    try {
      await notifyWorkspaceCreated(workspaceId, principalId);
    } catch (notifyErr) {
      console.error('Failed to notify workspace creation', workspaceId, notifyErr);
    }
  }

  async adopt(input: AdoptSessionWorkspaceInput): Promise<AdoptedSessionWorkspace> {
    const sessionId = requireId(input.sessionId, 'sessionId');
    const tenantId = requireId(input.tenantId, 'tenantId');
    const principalId = requireId(input.principalId, 'principalId');
    await this.checkTenantMember(tenantId, principalId);

    // One transaction covers workspace creation and the conditional binding
    // write: concurrent adopts conflict instead of overwriting each other, an
    // ended session cannot be resurrected, and a failed attach leaves no
    // orphan workspace behind.
    const { binding, seed: pendingSeed } = await db.transaction(async (tx) => {
      const store = this.storeFactory(tx);
      const mesh = createSessionWorkspaceBindingService(store);
      let seed: {
        readonly workspaceId: string; readonly type: WorkspaceType; readonly globalRole: string;
      } | null = null;
      let workspaceId: string;
      if (input.workspaceId) {
        const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1);
        if (!ws || ws.tenantId !== tenantId) {
          throw new SessionWorkspaceError('workspace_not_found', 'workspace does not exist');
        }
        if (!(await hasWorkspaceRole(principalId, ws.id, 'editor', tx))) {
          throw new SessionWorkspaceError('workspace_rights_refused', 'insufficient workspace rights');
        }
        workspaceId = ws.id;
      } else {
        if (!input.create?.name?.trim()) {
          throw new SessionWorkspaceError('invalid_request', 'either workspaceId or create is required');
        }
        const name = input.create.name.trim();
        if (name.length > 128) throw new SessionWorkspaceError('invalid_request', 'workspace name too long');
        const rawType = input.create.type ?? 'ai-priorities';
        const allowedTypes: WorkspaceType[] = ['code', 'ai-priorities', 'opportunity'];
        if (!allowedTypes.includes(rawType as WorkspaceType)) {
          throw new SessionWorkspaceError('invalid_request', `invalid workspace type: ${rawType}`);
        }
        const type = rawType as WorkspaceType;
        const globalRole = await this.requireGlobalEditor(principalId);
        workspaceId = await provisionWorkspace(tx, { ownerUserId: principalId, name, type, tenantId });
        seed = { workspaceId, type, globalRole };
      }
      let binding;
      try {
        binding = await mesh.attach({
          sessionId, workspaceId, sessionTenantId: tenantId,
          workspaceTenantId: tenantId, principalId,
        });
      } catch (err) {
        if (err instanceof SessionWorkspaceBindingError) throw new SessionWorkspaceError(err.code, err.message);
        throw err;
      }
      return { binding, seed };
    });
    if (pendingSeed) {
      await this.seedCreatedWorkspace(
        principalId, pendingSeed.globalRole, pendingSeed.workspaceId, pendingSeed.type,
      );
    }
    return toRecord(binding);
  }

  async detach(sessionId: string, tenantId: string, principalId: string): Promise<AdoptedSessionWorkspace> {
    requireId(sessionId, 'sessionId');
    requireId(tenantId, 'tenantId');
    requireId(principalId, 'principalId');
    // Membership first: a non-member learns nothing about binding existence.
    await this.checkTenantMember(tenantId, principalId);
    const binding = await db.transaction(async (tx) => {
      const store = this.storeFactory(tx);
      const mesh = createSessionWorkspaceBindingService(store);
      const existing = await store.findBySession(sessionId);
      if (!existing || existing.tenantId !== tenantId) {
        throw new SessionWorkspaceError('binding_not_found', 'no binding for session');
      }
      const isAdmin = await this.checkIsAdmin(tenantId, principalId, existing.workspaceId, tx);
      try {
        const binding = await mesh.detach({
          sessionId, tenantId, principalId, isAdmin, expectedVersion: existing.version,
        });
        if (binding.version !== existing.version + 1 || binding.workspaceId !== existing.workspaceId) {
          throw new SessionWorkspaceError('session_not_attached', 'concurrent modification; retry the detach');
        }
        return toRecord(binding);
      } catch (err) {
        if (err instanceof SessionWorkspaceBindingError) throw new SessionWorkspaceError(err.code, err.message);
        throw err;
      }
    });
    // Retained-closed transition: live D2 grants close, committed copies
    // stay under immutable origin scope; never fail the D1 detach when the
    // content service is unavailable.
    await this.fenceContent(sessionId, tenantId);
    return binding;
  }

  async end(sessionId: string, tenantId: string, principalId: string): Promise<AdoptedSessionWorkspace> {
    requireId(sessionId, 'sessionId');
    requireId(tenantId, 'tenantId');
    requireId(principalId, 'principalId');
    // Membership first: a non-member learns nothing about binding existence.
    await this.checkTenantMember(tenantId, principalId);
    const binding = await db.transaction(async (tx) => {
      const store = this.storeFactory(tx);
      const mesh = createSessionWorkspaceBindingService(store);
      const existing = await store.findBySession(sessionId);
      if (!existing || existing.tenantId !== tenantId) {
        throw new SessionWorkspaceError('binding_not_found', 'no binding for session');
      }
      const isAdmin = await this.checkIsAdmin(tenantId, principalId, existing.workspaceId, tx);
      try {
        const binding = await mesh.end({
          sessionId, tenantId, principalId, isAdmin, expectedVersion: existing.version,
        });
        // Idempotent replay: the domain returns the already-ended row
        // unchanged (same version), which never satisfies the write
        // post-control below — return it before that check.
        if (existing.status === 'ended') return toRecord(binding);
        if (binding.version !== existing.version + 1 || binding.workspaceId !== existing.workspaceId) {
          throw new SessionWorkspaceError('session_not_attached', 'concurrent modification; retry the end');
        }
        return toRecord(binding);
      } catch (err) {
        if (err instanceof SessionWorkspaceBindingError) throw new SessionWorkspaceError(err.code, err.message);
        throw err;
      }
    });
    await this.fenceContent(sessionId, tenantId);
    return binding;
  }

  async get(sessionId: string, tenantId: string, principalId: string): Promise<AdoptedSessionWorkspace | null> {
    requireId(sessionId, 'sessionId');
    requireId(tenantId, 'tenantId');
    requireId(principalId, 'principalId');
    await this.checkTenantMember(tenantId, principalId);
    const existing = await this.storeFactory(db).findBySession(sessionId);
    if (!existing || existing.tenantId !== tenantId) return null;
    const isAdmin = await this.checkIsAdmin(tenantId, principalId, existing.workspaceId);
    const binding = await this.mesh.get({ sessionId, tenantId, principalId, isAdmin });
    if (!binding) return null;
    // The row may have moved between the two reads (detach + re-attach).
    // Rights decided on the first read must never disclose the second row:
    // when the row moved, re-resolve rights on the row actually returned.
    if (binding.version !== existing.version || binding.status !== existing.status
      || binding.workspaceId !== existing.workspaceId || binding.principalId !== existing.principalId) {
      if (binding.tenantId !== tenantId) return null;
      if (binding.principalId !== principalId
        && !(await this.checkIsAdmin(tenantId, principalId, binding.workspaceId))) return null;
    }
    return toRecord(binding);
  }
}

export const sessionWorkspaceService = new SessionWorkspaceService();

