import { and, eq } from 'drizzle-orm';
import {
  createSessionWorkspaceBindingService,
  SessionWorkspaceBindingError,
  type SessionWorkspaceBinding,
  type SessionWorkspaceBindingStore,
} from '@sentropic/cluster-mesh';
import { db } from '../../db/client';
import { sessionWorkspaceBindings } from '../../db/control-schema';
import { tenantMemberships, users, workspaceMemberships, workspaces } from '../../db/schema';
import { getDefaultGateConfig } from '../gate-service';
import { todoOrchestrationService } from '../todo-orchestration';
import { viewTemplateService } from '../view-template-service';
import { hasWorkspaceRole, type WorkspaceType } from '../workspace-access';
import { createId } from '../../utils/id';

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
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
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

export const createDrizzleBindingStore = (client: BindingDbClient): SessionWorkspaceBindingStore => ({
  async findBySession(sessionId: string): Promise<SessionWorkspaceBinding | null> {
    const [row] = await client.select().from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, sessionId)).limit(1);
    return row ? toBinding(row) : null;
  },
  async compareAndSet(
    current: SessionWorkspaceBinding | null,
    next: SessionWorkspaceBinding,
  ): Promise<boolean> {
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

const drizzleBindingStore = createDrizzleBindingStore(db);

export class SessionWorkspaceService {
  private readonly mesh = createSessionWorkspaceBindingService(drizzleBindingStore);

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
    const levels: Record<string, number> = { admin_app: 4, admin_org: 3, editor: 2, guest: 1 };
    if ((levels[role] ?? 0) < (levels.editor ?? 2)) {
      throw new SessionWorkspaceError('workspace_rights_refused', 'global editor role required to create a workspace');
    }
    return role;
  }

  /**
   * Canonical workspace rows, mirroring the product workspaces route (creator
   * becomes admin member). Runs inside the adopt transaction so a failed
   * attach rolls the workspace back instead of orphaning it.
   */
  private async createWorkspaceInTx(
    tx: DbTx, tenantId: string, principalId: string, name: string, type: WorkspaceType,
  ): Promise<string> {
    const id = createId();
    const now = new Date();
    const gateConfig = getDefaultGateConfig(type);
    await tx.insert(workspaces).values({
      id, ownerUserId: principalId, name, type,
      gateConfig: gateConfig ?? undefined, tenantId, createdAt: now, updatedAt: now,
    });
    await tx.insert(workspaceMemberships).values({
      workspaceId: id, userId: principalId, role: 'admin', createdAt: now,
    });
    return id;
  }

  /**
   * Post-commit seeds for an adopted workspace: workflows/agents and view
   * templates for the type. Failures are non-fatal, exactly like the route.
   */
  private async seedCreatedWorkspace(
    principalId: string, globalRole: string, workspaceId: string, type: WorkspaceType,
  ): Promise<void> {
    try {
      await todoOrchestrationService.seedWorkflowsForType(
        { userId: principalId, role: globalRole, workspaceId }, type,
      );
    } catch (seedErr) {
      console.error('Failed to seed workflows for workspace type', type, seedErr);
    }
    try {
      await viewTemplateService.seedForWorkspace(workspaceId, type);
    } catch (seedErr) {
      console.error('Failed to seed view templates for workspace type', type, seedErr);
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
      const store = createDrizzleBindingStore(tx);
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
        workspaceId = await this.createWorkspaceInTx(tx, tenantId, principalId, name, type);
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
    return await db.transaction(async (tx) => {
      const store = createDrizzleBindingStore(tx);
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
  }

  async end(sessionId: string, tenantId: string, principalId: string): Promise<AdoptedSessionWorkspace> {
    requireId(sessionId, 'sessionId');
    requireId(tenantId, 'tenantId');
    requireId(principalId, 'principalId');
    // Membership first: a non-member learns nothing about binding existence.
    await this.checkTenantMember(tenantId, principalId);
    return await db.transaction(async (tx) => {
      const store = createDrizzleBindingStore(tx);
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
        if (binding.version !== existing.version + 1 || binding.workspaceId !== existing.workspaceId) {
          throw new SessionWorkspaceError('session_not_attached', 'concurrent modification; retry the end');
        }
        return toRecord(binding);
      } catch (err) {
        if (err instanceof SessionWorkspaceBindingError) throw new SessionWorkspaceError(err.code, err.message);
        throw err;
      }
    });
  }

  async get(sessionId: string, tenantId: string, principalId: string): Promise<AdoptedSessionWorkspace | null> {
    requireId(sessionId, 'sessionId');
    requireId(tenantId, 'tenantId');
    requireId(principalId, 'principalId');
    await this.checkTenantMember(tenantId, principalId);
    const existing = await drizzleBindingStore.findBySession(sessionId);
    if (!existing || existing.tenantId !== tenantId) return null;
    const isAdmin = await this.checkIsAdmin(tenantId, principalId, existing.workspaceId);
    const binding = await this.mesh.get({ sessionId, tenantId, principalId, isAdmin });
    return binding ? toRecord(binding) : null;
  }
}

export const sessionWorkspaceService = new SessionWorkspaceService();

