export type SessionWorkspaceBindingStatus = 'attached' | 'detached' | 'ended';

export interface SessionWorkspaceBinding {
  readonly bindingId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly principalId: string;
  readonly status: SessionWorkspaceBindingStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly detachedAt?: string;
  readonly endedAt?: string;
}

export interface SessionWorkspaceAttachmentInput {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly sessionTenantId: string;
  readonly workspaceTenantId: string;
  readonly principalId: string;
}

export interface SessionWorkspaceActionInput {
  readonly sessionId: string;
  readonly tenantId?: string;
  readonly principalId?: string;
  readonly isAdmin?: boolean;
}
export type SessionWorkspaceDetachInput = SessionWorkspaceActionInput;
export type SessionWorkspaceEndInput = SessionWorkspaceActionInput;

/** Narrow storage port; movable onto the generic cluster-mesh storage port (L3a) later. */
export interface SessionWorkspaceBindingStore {
  findBySession(sessionId: string): Promise<SessionWorkspaceBinding | null>;
  save(binding: SessionWorkspaceBinding): Promise<void>;
  /**
   * Conditional write: persist `next` only when the stored row still matches
   * `current` (`null` = no row must exist; otherwise same `sessionId` and
   * `status`). Returns `false` on conflict; the caller must re-read and map
   * the winning state instead of overwriting it.
   */
  compareAndSet(
    current: SessionWorkspaceBinding | null,
    next: SessionWorkspaceBinding,
  ): Promise<boolean>;
}

export type SessionWorkspaceBindingErrorCode =
  | 'invalid_request'
  | 'cross_tenant_refused'
  | 'workspace_rights_refused'
  | 'session_already_attached'
  | 'session_not_attached'
  | 'session_ended'
  | 'binding_not_found';

export class SessionWorkspaceBindingError extends Error {
  constructor(
    readonly code: SessionWorkspaceBindingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SessionWorkspaceBindingError';
  }
}

const requireId = (value: string, field: string): void => {
  if (!value.trim()) throw new SessionWorkspaceBindingError('invalid_request', `${field} is required`);
};

export const createSessionWorkspaceBindingService = (
  store: SessionWorkspaceBindingStore,
  options: { readonly now?: () => Date; readonly newId?: () => string } = {},
) => {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());

  const attach = async (input: SessionWorkspaceAttachmentInput): Promise<SessionWorkspaceBinding> => {
    requireId(input.sessionId, 'sessionId');
    requireId(input.workspaceId, 'workspaceId');
    requireId(input.sessionTenantId, 'sessionTenantId');
    requireId(input.workspaceTenantId, 'workspaceTenantId');
    requireId(input.principalId, 'principalId');
    if (input.sessionTenantId !== input.workspaceTenantId) {
      throw new SessionWorkspaceBindingError('cross_tenant_refused', 'workspace tenant does not match session tenant');
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await store.findBySession(input.sessionId);
      if (existing) {
        // Uniform refusal: a caller probing another tenant's session learns
        // nothing about the binding (same error as a missing binding).
        if (existing.tenantId !== input.sessionTenantId) {
          throw new SessionWorkspaceBindingError('binding_not_found', 'no binding for session');
        }
        if (existing.status === 'ended') {
          throw new SessionWorkspaceBindingError('session_ended', 'session is ended and keeps its workspace history');
        }
        if (existing.status === 'attached') {
          if (existing.workspaceId === input.workspaceId) return existing;
          throw new SessionWorkspaceBindingError(
            'session_already_attached',
            'session is already attached; detach or end it first',
          );
        }
        const reattached: SessionWorkspaceBinding = {
          ...existing, workspaceId: input.workspaceId, principalId: input.principalId,
          status: 'attached', updatedAt: now().toISOString(), detachedAt: undefined,
        };
        if (await store.compareAndSet(existing, reattached)) return reattached;
        continue;
      }
      const timestamp = now().toISOString();
      const binding: SessionWorkspaceBinding = {
        bindingId: newId(), sessionId: input.sessionId, workspaceId: input.workspaceId,
        tenantId: input.sessionTenantId, principalId: input.principalId, status: 'attached',
        createdAt: timestamp, updatedAt: timestamp,
      };
      if (await store.compareAndSet(null, binding)) return binding;
    }
    throw new SessionWorkspaceBindingError(
      'session_already_attached',
      'session is already attached; detach or end it first',
    );
  };

  const findAndAuthorize = async (
    target: string | SessionWorkspaceDetachInput,
    tenantIdArg?: string,
    principalIdArg?: string,
    isAdminArg = false,
  ): Promise<SessionWorkspaceBinding> => {
    const sessionId = typeof target === 'string' ? target : target.sessionId;
    const tenantId = typeof target === 'string' ? tenantIdArg : target.tenantId;
    const principalId = typeof target === 'string' ? principalIdArg : target.principalId;
    const isAdmin = typeof target === 'string' ? isAdminArg : (target.isAdmin ?? false);
    requireId(sessionId, 'sessionId');
    const existing = await store.findBySession(sessionId);
    if (!existing || (tenantId && existing.tenantId !== tenantId)) {
      throw new SessionWorkspaceBindingError('binding_not_found', 'no binding for session');
    }
    if (principalId && existing.principalId !== principalId && !isAdmin) {
      throw new SessionWorkspaceBindingError('workspace_rights_refused', 'insufficient rights for session');
    }
    return existing;
  };

  const detach = async (
    target: string | SessionWorkspaceDetachInput,
    tenantIdArg?: string,
    principalIdArg?: string,
    isAdminArg = false,
  ): Promise<SessionWorkspaceBinding> => {
    const existing = await findAndAuthorize(target, tenantIdArg, principalIdArg, isAdminArg);
    if (existing.status === 'ended') {
      throw new SessionWorkspaceBindingError('session_ended', 'session is ended and keeps its workspace history');
    }
    if (existing.status !== 'attached') {
      throw new SessionWorkspaceBindingError('session_not_attached', 'session is not attached');
    }
    const timestamp = now().toISOString();
    const detached: SessionWorkspaceBinding = {
      ...existing, status: 'detached', updatedAt: timestamp, detachedAt: timestamp,
    };
    await store.save(detached);
    return detached;
  };

  const end = async (
    target: string | SessionWorkspaceEndInput,
    tenantIdArg?: string,
    principalIdArg?: string,
    isAdminArg = false,
  ): Promise<SessionWorkspaceBinding> => {
    const existing = await findAndAuthorize(target, tenantIdArg, principalIdArg, isAdminArg);
    if (existing.status === 'ended') return existing;
    const timestamp = now().toISOString();
    const ended: SessionWorkspaceBinding = {
      ...existing, status: 'ended', updatedAt: timestamp, endedAt: timestamp,
    };
    await store.save(ended);
    return ended;
  };

  const get = async (sessionId: string, tenantId?: string): Promise<SessionWorkspaceBinding | null> => {
    requireId(sessionId, 'sessionId');
    const existing = await store.findBySession(sessionId);
    if (!existing) return null;
    if (tenantId && existing.tenantId !== tenantId) return null;
    return existing;
  };

  return { attach, detach, end, get };
};
