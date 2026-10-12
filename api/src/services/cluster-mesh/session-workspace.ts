import { and, eq } from 'drizzle-orm';
import {
  createSessionWorkspaceBindingService,
  SessionWorkspaceBindingError,
  type SessionWorkspaceBinding,
  type SessionWorkspaceBindingStore,
} from '@sentropic/cluster-mesh';
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
  readonly principalId?: string;
  readonly status: AdoptedSessionWorkspaceStatus;
}

export type SessionWorkspaceErrorCode =
  | 'invalid_request' | 'workspace_not_found' | 'cross_tenant_refused' | 'workspace_rights_refused'
  | 'session_already_attached' | 'session_not_attached' | 'session_ended' | 'binding_not_found';

export class SessionWorkspaceError extends SessionWorkspaceBindingError {
  override readonly code: SessionWorkspaceErrorCode;
  constructor(code: SessionWorkspaceErrorCode, message: string) {
    super(code as any, message);
    this.code = code;
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
    await db.insert(sessionWorkspaceBindings).values({
      bindingId: b.bindingId, sessionId: b.sessionId, workspaceId: b.workspaceId,
      tenantId: b.tenantId, principalId: b.principalId, status: b.status,
      createdAt: new Date(b.createdAt), updatedAt: new Date(b.updatedAt),
      detachedAt: b.detachedAt ? new Date(b.detachedAt) : null,
      endedAt: b.endedAt ? new Date(b.endedAt) : null,
    }).onConflictDoUpdate({
      target: sessionWorkspaceBindings.sessionId,
      set: {
        workspaceId: b.workspaceId, tenantId: b.tenantId, principalId: b.principalId,
        status: b.status, updatedAt: new Date(b.updatedAt),
        detachedAt: b.detachedAt ? new Date(b.detachedAt) : null,
        endedAt: b.endedAt ? new Date(b.endedAt) : null,
      },
    });
  },
};

export class SessionWorkspaceService {
  private readonly mesh = createSessionWorkspaceBindingService(drizzleBindingStore);

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

  async detach(sessionId: string, tenantId: string, principalId?: string): Promise<AdoptedSessionWorkspace> {
    requireId(sessionId, 'sessionId');
    requireId(tenantId, 'tenantId');
    try {
      const binding = await this.mesh.detach(sessionId, tenantId, principalId);
      return toRecord(binding);
    } catch (err) {
      if (err instanceof SessionWorkspaceBindingError) throw new SessionWorkspaceError(err.code, err.message);
      throw err;
    }
  }

  async end(sessionId: string, tenantId: string, principalId?: string): Promise<AdoptedSessionWorkspace> {
    requireId(sessionId, 'sessionId');
    requireId(tenantId, 'tenantId');
    try {
      const binding = await this.mesh.end(sessionId, tenantId, principalId);
      return toRecord(binding);
    } catch (err) {
      if (err instanceof SessionWorkspaceBindingError) throw new SessionWorkspaceError(err.code, err.message);
      throw err;
    }
  }

  async get(sessionId: string, tenantId: string): Promise<AdoptedSessionWorkspace | null> {
    requireId(sessionId, 'sessionId');
    requireId(tenantId, 'tenantId');
    const binding = await this.mesh.get(sessionId, tenantId);
    return binding ? toRecord(binding) : null;
  }
}

export const sessionWorkspaceService = new SessionWorkspaceService();

