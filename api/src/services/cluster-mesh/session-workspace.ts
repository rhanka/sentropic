import { and, eq } from 'drizzle-orm';
import {
  createSessionWorkspaceBindingService,
  SessionWorkspaceBindingError,
  type SessionWorkspaceBinding,
  type SessionWorkspaceBindingStore,
} from '@sentropic/cluster-mesh';
import { db } from '../../db/client';
import { sessionWorkspaceBindings } from '../../db/control-schema';
import { tenantMemberships, workspaceMemberships, workspaces } from '../../db/schema';
import { getDefaultGateConfig } from '../gate-service';
import { hasWorkspaceRole, type WorkspaceType } from '../workspace-access';

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
const requireId = (value: string | undefined, field: string): string => {
  if (!value?.trim()) throw new SessionWorkspaceError('invalid_request', `${field} is required`);
  return value;
};
const toRecord = (b: SessionWorkspaceBinding | BindingRow): AdoptedSessionWorkspace => ({
  bindingId: b.bindingId, sessionId: b.sessionId, workspaceId: b.workspaceId,
  tenantId: b.tenantId, principalId: b.principalId ?? undefined,
  status: b.status as AdoptedSessionWorkspaceStatus,
});
const toRow = (b: SessionWorkspaceBinding) => ({
  bindingId: b.bindingId, sessionId: b.sessionId, workspaceId: b.workspaceId,
  tenantId: b.tenantId, principalId: b.principalId, status: b.status,
  createdAt: new Date(b.createdAt), updatedAt: new Date(b.updatedAt),
  detachedAt: b.detachedAt ? new Date(b.detachedAt) : null,
  endedAt: b.endedAt ? new Date(b.endedAt) : null,
});

const drizzleBindingStore: SessionWorkspaceBindingStore = {
  async findBySession(sessionId: string): Promise<SessionWorkspaceBinding | null> {
    const [row] = await db.select().from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, sessionId)).limit(1);
    if (!row) return null;
    return {
      bindingId: row.bindingId, sessionId: row.sessionId, workspaceId: row.workspaceId,
      tenantId: row.tenantId, principalId: row.principalId ?? '',
      status: row.status as SessionWorkspaceBinding['status'],
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      detachedAt: row.detachedAt ? row.detachedAt.toISOString() : undefined,
      endedAt: row.endedAt ? row.endedAt.toISOString() : undefined,
    };
  },
  async save(b: SessionWorkspaceBinding): Promise<void> {
    await db.insert(sessionWorkspaceBindings).values(toRow(b)).onConflictDoUpdate({
      target: sessionWorkspaceBindings.sessionId,
      set: {
        workspaceId: b.workspaceId, tenantId: b.tenantId, principalId: b.principalId,
        status: b.status, updatedAt: new Date(b.updatedAt),
        detachedAt: b.detachedAt ? new Date(b.detachedAt) : null,
        endedAt: b.endedAt ? new Date(b.endedAt) : null,
      },
    });
  },
  async compareAndSet(
    current: SessionWorkspaceBinding | null,
    next: SessionWorkspaceBinding,
  ): Promise<boolean> {
    if (current === null) {
      const inserted = await db.insert(sessionWorkspaceBindings).values(toRow(next))
        .onConflictDoNothing()
        .returning({ bindingId: sessionWorkspaceBindings.bindingId });
      return inserted.length > 0;
    }
    const updated = await db.update(sessionWorkspaceBindings).set({
      workspaceId: next.workspaceId, tenantId: next.tenantId, principalId: next.principalId,
      status: next.status, updatedAt: new Date(next.updatedAt),
      detachedAt: next.detachedAt ? new Date(next.detachedAt) : null,
      endedAt: next.endedAt ? new Date(next.endedAt) : null,
    }).where(and(
      eq(sessionWorkspaceBindings.sessionId, next.sessionId),
      eq(sessionWorkspaceBindings.status, current.status),
    )).returning({ bindingId: sessionWorkspaceBindings.bindingId });
    return updated.length > 0;
  },
};

export class SessionWorkspaceService {
  private readonly mesh = createSessionWorkspaceBindingService(drizzleBindingStore);

  private async checkTenantMember(tenantId: string, principalId: string): Promise<void> {
    const [membership] = await db.select({ status: tenantMemberships.status }).from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, principalId))).limit(1);
    if (membership?.status !== 'approved') {
      throw new SessionWorkspaceError('workspace_rights_refused', 'principal is not an approved member of the tenant');
    }
  }

  private async checkIsAdmin(tenantId: string, principalId: string, workspaceId: string): Promise<boolean> {
    const [tMember] = await db.select({ role: tenantMemberships.role, status: tenantMemberships.status }).from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, principalId))).limit(1);
    if (tMember?.status === 'approved' && (tMember.role === 'admin' || tMember.role === 'owner')) return true;
    if (workspaceId) return await hasWorkspaceRole(principalId, workspaceId, 'admin');
    return false;
  }

  private async resolveWorkspaceId(tenantId: string, principalId: string, wId?: string, create?: { name: string; type?: string }): Promise<string> {
    if (wId) {
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wId)).limit(1);
      if (!ws || ws.tenantId !== tenantId) {
        throw new SessionWorkspaceError('workspace_not_found', 'workspace does not exist');
      }
      const canEdit = await hasWorkspaceRole(principalId, ws.id, 'editor');
      if (!canEdit) {
        throw new SessionWorkspaceError('workspace_rights_refused', 'insufficient workspace rights');
      }
      return ws.id;
    }
    if (!create?.name?.trim()) throw new SessionWorkspaceError('invalid_request', 'either workspaceId or create is required');
    const name = create.name.trim();
    if (name.length > 128) throw new SessionWorkspaceError('invalid_request', 'workspace name too long');
    const rawType = create.type ?? 'code';
    const allowedTypes: WorkspaceType[] = ['code', 'ai-priorities', 'opportunity'];
    if (!allowedTypes.includes(rawType as WorkspaceType)) {
      throw new SessionWorkspaceError('invalid_request', `invalid workspace type: ${rawType}`);
    }
    const type = rawType as WorkspaceType;
    const id = crypto.randomUUID();
    const now = new Date();
    const gateConfig = getDefaultGateConfig(type);
    await db.transaction(async (tx) => {
      await tx.insert(workspaces).values({
        id, ownerUserId: principalId, name, type,
        gateConfig: gateConfig ?? undefined, tenantId, createdAt: now, updatedAt: now,
      });
      await tx.insert(workspaceMemberships).values({
        workspaceId: id, userId: principalId, role: 'admin', createdAt: now,
      });
    });
    return id;
  }

  async adopt(input: AdoptSessionWorkspaceInput): Promise<AdoptedSessionWorkspace> {
    const sessionId = requireId(input.sessionId, 'sessionId');
    const tenantId = requireId(input.tenantId, 'tenantId');
    const principalId = requireId(input.principalId, 'principalId');
    await this.checkTenantMember(tenantId, principalId);

    const existing = await drizzleBindingStore.findBySession(sessionId);
    if (existing) {
      if (existing.tenantId !== tenantId) {
        throw new SessionWorkspaceError('binding_not_found', 'no binding for session');
      }
      if (existing.status === 'ended') {
        throw new SessionWorkspaceError('session_ended', 'session is ended and keeps its workspace history');
      }
      if (existing.status === 'attached') {
        if (input.workspaceId && existing.workspaceId === input.workspaceId) return toRecord(existing);
        throw new SessionWorkspaceError('session_already_attached', 'session is already attached; detach or end it first');
      }
    }

    const workspaceId = await this.resolveWorkspaceId(tenantId, principalId, input.workspaceId, input.create);
    try {
      const binding = await this.mesh.attach({
        sessionId, workspaceId, sessionTenantId: tenantId,
        workspaceTenantId: tenantId, principalId,
      });
      return toRecord(binding);
    } catch (err) {
      if (err instanceof SessionWorkspaceBindingError) throw new SessionWorkspaceError(err.code, err.message);
      throw err;
    }
  }

  async detach(sessionId: string, tenantId: string, principalId: string): Promise<AdoptedSessionWorkspace> {
    requireId(sessionId, 'sessionId');
    requireId(tenantId, 'tenantId');
    requireId(principalId, 'principalId');
    // Membership first: a non-member learns nothing about binding existence.
    await this.checkTenantMember(tenantId, principalId);
    const existing = await drizzleBindingStore.findBySession(sessionId);
    if (!existing || existing.tenantId !== tenantId) {
      throw new SessionWorkspaceError('binding_not_found', 'no binding for session');
    }
    const isAdmin = await this.checkIsAdmin(tenantId, principalId, existing.workspaceId);
    try {
      const binding = await this.mesh.detach({ sessionId, tenantId, principalId, isAdmin });
      return toRecord(binding);
    } catch (err) {
      if (err instanceof SessionWorkspaceBindingError) throw new SessionWorkspaceError(err.code, err.message);
      throw err;
    }
  }

  async end(sessionId: string, tenantId: string, principalId: string): Promise<AdoptedSessionWorkspace> {
    requireId(sessionId, 'sessionId');
    requireId(tenantId, 'tenantId');
    requireId(principalId, 'principalId');
    // Membership first: a non-member learns nothing about binding existence.
    await this.checkTenantMember(tenantId, principalId);
    const existing = await drizzleBindingStore.findBySession(sessionId);
    if (!existing || existing.tenantId !== tenantId) {
      throw new SessionWorkspaceError('binding_not_found', 'no binding for session');
    }
    const isAdmin = await this.checkIsAdmin(tenantId, principalId, existing.workspaceId);
    try {
      const binding = await this.mesh.end({ sessionId, tenantId, principalId, isAdmin });
      return toRecord(binding);
    } catch (err) {
      if (err instanceof SessionWorkspaceBindingError) throw new SessionWorkspaceError(err.code, err.message);
      throw err;
    }
  }

  async get(sessionId: string, tenantId: string, principalId: string): Promise<AdoptedSessionWorkspace | null> {
    requireId(sessionId, 'sessionId');
    requireId(tenantId, 'tenantId');
    requireId(principalId, 'principalId');
    await this.checkTenantMember(tenantId, principalId);
    const binding = await this.mesh.get({ sessionId, tenantId, principalId });
    return binding ? toRecord(binding) : null;
  }
}

export const sessionWorkspaceService = new SessionWorkspaceService();

