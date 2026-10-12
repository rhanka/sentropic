import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { sessionWorkspaceBindings } from '../../db/control-schema';
import { tenantMemberships, workspaces } from '../../db/schema';

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
const toRecord = (row: BindingRow): AdoptedSessionWorkspace => ({
  bindingId: row.bindingId, sessionId: row.sessionId, workspaceId: row.workspaceId,
  tenantId: row.tenantId, status: row.status as AdoptedSessionWorkspaceStatus,
});
const loadBinding = async (sessionId: string, tenantId: string | null): Promise<BindingRow | undefined> => {
  const [row] = await db.select().from(sessionWorkspaceBindings)
    .where(eq(sessionWorkspaceBindings.sessionId, sessionId)).limit(1);
  if (row && tenantId && row.tenantId !== tenantId) {
    throw new SessionWorkspaceError('cross_tenant_refused', 'session tenant does not match binding tenant');
  }
  return row;
};

export class SessionWorkspaceService {
  private async checkRights(tenantId: string, principalId: string): Promise<void> {
    const [membership] = await db.select({ status: tenantMemberships.status }).from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, principalId))).limit(1);
    if (membership?.status !== 'approved') {
      throw new SessionWorkspaceError('workspace_rights_refused', 'principal is not an approved member of the tenant');
    }
  }

  private async resolveWorkspaceId(tenantId: string, principalId: string, wId?: string, create?: { name: string; type?: string }): Promise<string> {
    if (wId) {
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wId)).limit(1);
      if (!ws) throw new SessionWorkspaceError('workspace_not_found', 'workspace does not exist');
      if (ws.tenantId !== tenantId) {
        throw new SessionWorkspaceError('cross_tenant_refused', 'workspace tenant does not match session tenant');
      }
      return ws.id;
    }
    if (!create?.name?.trim()) throw new SessionWorkspaceError('invalid_request', 'either workspaceId or create is required');
    const id = crypto.randomUUID();
    await db.insert(workspaces).values(
      { id, ownerUserId: principalId, name: create.name, type: create.type ?? 'code', tenantId });
    return id;
  }
  async adopt(input: AdoptSessionWorkspaceInput): Promise<AdoptedSessionWorkspace> {
    const sessionId = requireId(input.sessionId, 'sessionId');
    const tenantId = requireId(input.tenantId, 'tenantId');
    const principalId = requireId(input.principalId, 'principalId');
    await this.checkRights(tenantId, principalId);
    const workspaceId = await this.resolveWorkspaceId(tenantId, principalId, input.workspaceId, input.create);
    const existing = await loadBinding(sessionId, tenantId);
    if (!existing) {
      const [created] = await db.insert(sessionWorkspaceBindings).values({
        bindingId: crypto.randomUUID(), sessionId, workspaceId, tenantId, status: 'attached',
      }).returning();
      return toRecord(created!);
    }
    if (existing.status === 'ended') {
      throw new SessionWorkspaceError('session_ended', 'session is ended and keeps its workspace history');
    }
    if (existing.status === 'attached') {
      if (existing.workspaceId === workspaceId) return toRecord(existing);
      throw new SessionWorkspaceError('session_already_attached', 'session is already attached; detach or end it first');
    }
    const [reattached] = await db.update(sessionWorkspaceBindings)
      .set({ workspaceId, status: 'attached', updatedAt: new Date(), detachedAt: null })
      .where(eq(sessionWorkspaceBindings.sessionId, sessionId)).returning();
    return toRecord(reattached!);
  }
  async detach(sessionId: string, tenantId: string): Promise<AdoptedSessionWorkspace> {
    requireId(sessionId, 'sessionId');
    requireId(tenantId, 'tenantId');
    const existing = await loadBinding(sessionId, tenantId);
    if (!existing) throw new SessionWorkspaceError('binding_not_found', 'no binding for session');
    if (existing.status === 'ended') {
      throw new SessionWorkspaceError('session_ended', 'session is ended and keeps its workspace history');
    }
    if (existing.status !== 'attached') {
      throw new SessionWorkspaceError('session_not_attached', 'session is not attached');
    }
    const [detached] = await db.update(sessionWorkspaceBindings)
      .set({ status: 'detached', updatedAt: new Date(), detachedAt: new Date() })
      .where(eq(sessionWorkspaceBindings.sessionId, sessionId)).returning();
    return toRecord(detached!);
  }
  async end(sessionId: string, tenantId: string): Promise<AdoptedSessionWorkspace> {
    requireId(sessionId, 'sessionId');
    requireId(tenantId, 'tenantId');
    const existing = await loadBinding(sessionId, tenantId);
    if (!existing) throw new SessionWorkspaceError('binding_not_found', 'no binding for session');
    if (existing.status === 'ended') return toRecord(existing);
    const [ended] = await db.update(sessionWorkspaceBindings)
      .set({ status: 'ended', updatedAt: new Date(), endedAt: new Date() })
      .where(eq(sessionWorkspaceBindings.sessionId, sessionId)).returning();
    return toRecord(ended!);
  }
  async get(sessionId: string, tenantId: string): Promise<AdoptedSessionWorkspace | null> {
    requireId(sessionId, 'sessionId');
    requireId(tenantId, 'tenantId');
    const existing = await loadBinding(sessionId, null);
    if (!existing || existing.tenantId !== tenantId) return null;
    return toRecord(existing);
  }
}

export const sessionWorkspaceService = new SessionWorkspaceService();
