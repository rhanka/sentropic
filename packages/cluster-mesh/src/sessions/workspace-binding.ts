export type SessionWorkspaceBindingStatus = 'attached' | 'detached' | 'ended';

export interface SessionWorkspaceBinding {
  readonly bindingId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly principalId: string;
  readonly status: SessionWorkspaceBindingStatus;
  readonly version: number;
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

export interface SessionWorkspaceDetachInput {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly principalId: string;
  /**
   * Whether the principal administers the tenant or workspace. Resolved by the
   * caller from membership tables (the domain owns no database access);
   * required so the ownership check cannot be bypassed by omission.
   */
  readonly isAdmin: boolean;
  /**
   * Version read by the caller before invoking detach/end. While set, the
   * operation only proceeds while the stored row still carries that version,
   * so rights evaluated on the read state can never apply to a newer binding.
   */
  readonly expectedVersion?: number;
}
export type SessionWorkspaceEndInput = SessionWorkspaceDetachInput;

export interface SessionWorkspaceGetInput {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly principalId: string;
  /**
   * Whether the principal administers the tenant or workspace. Only the
   * owner or an admin may read the binding (it carries the principalId);
   * other members observe null, exactly like a tenant mismatch.
   */
  readonly isAdmin: boolean;
}

/**
 * Production CAS tuple comparison shared by every store: the stored row
 * still matches the expected state only when the session, the monotonic
 * version and the full expected state (status, workspace, principal) agree.
 */
export const isExpectedBindingState = (
  existing: SessionWorkspaceBinding | null,
  current: SessionWorkspaceBinding | null,
): boolean => {
  if (!existing || !current) return false;
  return existing.sessionId === current.sessionId
    && existing.version === current.version
    && existing.status === current.status
    && existing.workspaceId === current.workspaceId
    && existing.principalId === current.principalId;
};

/** Narrow storage port; movable onto the generic cluster-mesh storage port (L3a) later. */
export interface SessionWorkspaceBindingStore {
  findBySession(sessionId: string): Promise<SessionWorkspaceBinding | null>;
  /**
   * Conditional write: persist `next` only when the stored row still matches
   * `current` (`null` = no row must exist; otherwise matching `sessionId`,
   * monotonic `version`, and full expected state). Returns `false` on conflict;
   * the caller must re-read and map the winning state instead of overwriting it.
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

const requireId: (value: unknown, field: string) => asserts value is string = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SessionWorkspaceBindingError('invalid_request', `${field} is required`);
  }
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
        // Uniform refusal without tenant disclosure: from any other tenant
        // this session is simply already bound elsewhere (same error as a
        // same-tenant conflict, with no hint about where it is bound).
        if (existing.tenantId !== input.sessionTenantId) {
          throw new SessionWorkspaceBindingError(
            'session_already_attached',
            'session is already attached; detach or end it first',
          );
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
          status: 'attached', version: existing.version + 1, updatedAt: now().toISOString(), detachedAt: undefined,
        };
        if (await store.compareAndSet(existing, reattached)) return reattached;
        continue;
      }
      const timestamp = now().toISOString();
      const binding: SessionWorkspaceBinding = {
        bindingId: newId(), sessionId: input.sessionId, workspaceId: input.workspaceId,
        tenantId: input.sessionTenantId, principalId: input.principalId, status: 'attached',
        version: 1,
        createdAt: timestamp, updatedAt: timestamp,
      };
      if (await store.compareAndSet(null, binding)) return binding;
    }
    throw new SessionWorkspaceBindingError(
      'session_already_attached',
      'session is already attached; detach or end it first',
    );
  };

  const authorize = async (
    input: SessionWorkspaceDetachInput,
  ): Promise<SessionWorkspaceBinding> => {
    requireId(input?.sessionId, 'sessionId');
    requireId(input?.tenantId, 'tenantId');
    requireId(input?.principalId, 'principalId');
    if (typeof input?.isAdmin !== 'boolean') {
      throw new SessionWorkspaceBindingError('invalid_request', 'isAdmin is required');
    }
    // Uniform refusal: existence and tenant match are hidden behind one error.
    const existing = await store.findBySession(input.sessionId);
    if (!existing || existing.tenantId !== input.tenantId) {
      throw new SessionWorkspaceBindingError('binding_not_found', 'no binding for session');
    }
    if (existing.principalId !== input.principalId && !input.isAdmin) {
      throw new SessionWorkspaceBindingError('workspace_rights_refused', 'insufficient rights for session');
    }
    return existing;
  };

  const detach = async (input: SessionWorkspaceDetachInput): Promise<SessionWorkspaceBinding> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await authorize(input);
      if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
        throw new SessionWorkspaceBindingError('session_not_attached', 'concurrent modification; retry the detach');
      }
      if (existing.status === 'ended') {
        throw new SessionWorkspaceBindingError('session_ended', 'session is ended and keeps its workspace history');
      }
      if (existing.status !== 'attached') {
        throw new SessionWorkspaceBindingError('session_not_attached', 'session is not attached');
      }
      const timestamp = now().toISOString();
      const detached: SessionWorkspaceBinding = {
        ...existing, status: 'detached', version: existing.version + 1, updatedAt: timestamp, detachedAt: timestamp,
      };
      if (await store.compareAndSet(existing, detached)) return detached;
    }
    throw new SessionWorkspaceBindingError('session_not_attached', 'concurrent modification; retry the detach');
  };

  const end = async (input: SessionWorkspaceEndInput): Promise<SessionWorkspaceBinding> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await authorize(input);
      if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
        throw new SessionWorkspaceBindingError('session_not_attached', 'concurrent modification; retry the end');
      }
      if (existing.status === 'ended') return existing;
      const timestamp = now().toISOString();
      const ended: SessionWorkspaceBinding = {
        ...existing, status: 'ended', version: existing.version + 1, updatedAt: timestamp, endedAt: timestamp,
      };
      if (await store.compareAndSet(existing, ended)) return ended;
    }
    const latest = await store.findBySession(input.sessionId);
    if (latest && latest.tenantId === input.tenantId && latest.status === 'ended') return latest;
    throw new SessionWorkspaceBindingError('session_not_attached', 'concurrent modification; retry the end');
  };

  const get = async (input: SessionWorkspaceGetInput): Promise<SessionWorkspaceBinding | null> => {
    requireId(input?.sessionId, 'sessionId');
    requireId(input?.tenantId, 'tenantId');
    requireId(input?.principalId, 'principalId');
    if (typeof input?.isAdmin !== 'boolean') {
      throw new SessionWorkspaceBindingError('invalid_request', 'isAdmin is required');
    }
    const existing = await store.findBySession(input.sessionId);
    if (!existing || existing.tenantId !== input.tenantId) return null;
    if (existing.principalId !== input.principalId && !input.isAdmin) return null;
    return existing;
  };

  return { attach, detach, end, get };
};
