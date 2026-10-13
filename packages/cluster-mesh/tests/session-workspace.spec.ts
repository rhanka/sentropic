import { describe, expect, it } from 'vitest';
import {
  createSessionWorkspaceBindingService,
  isExpectedBindingState,
  type SessionWorkspaceBinding,
  type SessionWorkspaceBindingStore,
} from '../src/sessions/workspace-binding.js';

const memoryStore = (): SessionWorkspaceBindingStore & { rows: Map<string, SessionWorkspaceBinding> } => {
  const rows = new Map<string, SessionWorkspaceBinding>();
  return {
    rows,
    async findBySession(sessionId: string) { return rows.get(sessionId) ?? null; },
    async compareAndSet(current: SessionWorkspaceBinding | null, next: SessionWorkspaceBinding) {
      const existing = rows.get(next.sessionId) ?? null;
      if (current === null) {
        if (existing) return false;
        rows.set(next.sessionId, next);
        return true;
      }
      // Same production tuple comparison as every store (MAJ-B).
      if (!isExpectedBindingState(existing, current)) return false;
      rows.set(next.sessionId, next);
      return true;
    },
  };
};

const attachInput = (overrides = {}) => ({
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
  sessionTenantId: 'tenant-a',
  workspaceTenantId: 'tenant-a',
  principalId: 'user-1',
  ...overrides,
});

describe('session workspace binding', () => {
  it('should attach an existing workspace durably', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    const binding = await service.attach(attachInput());
    expect(binding.status).toBe('attached');
    expect(binding.workspaceId).toBe('workspace-1');
    await expect(store.findBySession('session-1')).resolves.toEqual(binding);
  });

  it('should reuse the binding when the same session attaches twice', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    const first = await service.attach(attachInput());
    const second = await service.attach(attachInput());
    expect(second.bindingId).toBe(first.bindingId);
    expect(store.rows.size).toBe(1);
  });

  it('should refuse a second workspace while attached', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput());
    await expect(service.attach(attachInput({ workspaceId: 'workspace-2' })))
      .rejects.toMatchObject({ code: 'session_already_attached' });
  });

  it('should keep the workspace ref after detach and allow re-attach', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput());
    const detached = await service.detach({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1', isAdmin: false,
      expectedVersion: 1,
    });
    expect(detached.status).toBe('detached');
    expect(detached.workspaceId).toBe('workspace-1');
    const reattached = await service.attach(attachInput({ workspaceId: 'workspace-2' }));
    expect(reattached.status).toBe('attached');
  });

  it('should keep the workspace ref after end and forbid reuse', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput());
    const ended = await service.end({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1', isAdmin: false,
      expectedVersion: 1,
    });
    expect(ended.status).toBe('ended');
    expect(ended.workspaceId).toBe('workspace-1');
    await expect(service.attach(attachInput())).rejects.toMatchObject({ code: 'session_ended' });
  });

  it('should store principalId on attach', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    const binding = await service.attach(attachInput({ principalId: 'user-1' }));
    expect(binding.principalId).toBe('user-1');
  });

  it('should enforce rights on detach: refuse unauthorized caller, allow owner and admin', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput({ principalId: 'user-1' }));
    await expect(service.detach({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-2', isAdmin: false,
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'workspace_rights_refused' });
    const detached = await service.detach({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-2', isAdmin: true,
      expectedVersion: 1,
    });
    expect(detached.status).toBe('detached');
  });

  it('should enforce rights on end: refuse unauthorized caller, allow owner and admin', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput({ principalId: 'user-1' }));
    await expect(service.end({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-2', isAdmin: false,
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'workspace_rights_refused' });
    const ended = await service.end({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-2', isAdmin: true,
      expectedVersion: 1,
    });
    expect(ended.status).toBe('ended');
  });

  it('should refuse cross-tenant attach', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await expect(service.attach(attachInput({ workspaceTenantId: 'tenant-b' })))
      .rejects.toMatchObject({ code: 'cross_tenant_refused' });
  });

  it('should recover the binding after restart from the same store', async () => {
    const store = memoryStore();
    const before = createSessionWorkspaceBindingService(store);
    await before.attach(attachInput());
    const after = createSessionWorkspaceBindingService(store);
    await expect(after.get({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1', isAdmin: false,
    })).resolves.toMatchObject({
      sessionId: 'session-1', workspaceId: 'workspace-1', status: 'attached',
    });
  });

  it('should refuse detach when principal is omitted', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput());
    await expect(service.detach({
      sessionId: 'session-1', tenantId: 'tenant-a',
      principalId: undefined as unknown as string, isAdmin: false, expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('should refuse end when principal is omitted', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput());
    await expect(service.end({
      sessionId: 'session-1', tenantId: 'tenant-a',
      principalId: undefined as unknown as string, isAdmin: false, expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('should refuse detach and end when expectedVersion is omitted', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput());
    // `expectedVersion` is required like `isAdmin`: omitting it must fail
    // closed instead of falling back to the unpinned behavior.
    const withoutVersion = {
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1', isAdmin: false,
    } as unknown as Parameters<typeof service.detach>[0];
    await expect(service.detach(withoutVersion)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.end(withoutVersion)).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('should refuse detach when tenant is omitted', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput());
    const detachWithoutTenant = service.detach as unknown as (sessionId: string) => Promise<unknown>;
    await expect(detachWithoutTenant('session-1'))
      .rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('should refuse end when tenant is omitted', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput());
    const endWithoutTenant = service.end as unknown as (sessionId: string) => Promise<unknown>;
    await expect(endWithoutTenant('session-1'))
      .rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('should require principal on get', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput());
    const getWithoutPrincipal = service.get as unknown as (sessionId: string, tenantId: string) => Promise<unknown>;
    await expect(getWithoutPrincipal('session-1', 'tenant-a'))
      .rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('should return the binding on get with tenant and principal', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput());
    await expect(service.get({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1', isAdmin: false,
    })).resolves.toMatchObject({
      sessionId: 'session-1', workspaceId: 'workspace-1', status: 'attached',
    });
  });

  it('should refuse cross-tenant attach on a bound session without leaking the tenant', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput());
    await expect(service.attach(attachInput({ sessionTenantId: 'tenant-b', workspaceTenantId: 'tenant-b' })))
      .rejects.toMatchObject({ code: 'session_already_attached' });
  });

  it('should hide the binding on get from a member who is neither owner nor admin', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput());
    await expect(service.get({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-2', isAdmin: false,
    })).resolves.toBeNull();
  });

  it('should expose the binding on get to an admin who does not own it', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput());
    await expect(service.get({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-2', isAdmin: true,
    })).resolves.toMatchObject({ sessionId: 'session-1', status: 'attached' });
  });

  it('should refuse a stale workspace-admin detach bound to the read version', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput({ workspaceId: 'workspace-1', principalId: 'user-1' }));

    const originalFindBySession = store.findBySession.bind(store);
    let raceTriggered = false;
    store.findBySession = async (sessionId: string) => {
      const row = await originalFindBySession(sessionId);
      if (!raceTriggered && row?.status === 'attached' && row.workspaceId === 'workspace-1') {
        raceTriggered = true;
        await service.detach({
          sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1', isAdmin: false,
          expectedVersion: 1,
        });
        await service.attach(attachInput({ workspaceId: 'workspace-2', principalId: 'user-2' }));
      }
      return row;
    };

    // Caller administers the originally read workspace only; the stale
    // detach must not touch the re-attached binding.
    await expect(service.detach({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-3',
      isAdmin: true, expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'session_not_attached' });

    const current = await originalFindBySession('session-1');
    expect(current?.workspaceId).toBe('workspace-2');
    expect(current?.principalId).toBe('user-2');
    expect(current?.status).toBe('attached');
    expect(current?.version).toBe(3);
  });

  it('should conflict when two attaches race for different workspaces', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    const outcomes = await Promise.allSettled([
      service.attach(attachInput({ workspaceId: 'workspace-1' })),
      service.attach(attachInput({ workspaceId: 'workspace-2' })),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'session_already_attached' });
  });

  it('should converge concurrent attaches of the same workspace', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    const [first, second] = await Promise.all([
      service.attach(attachInput()),
      service.attach(attachInput()),
    ]);
    expect(second.bindingId).toBe(first.bindingId);
  });

  it('should refuse detach on an ended session', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput());
    await service.end({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1', isAdmin: true,
      expectedVersion: 1,
    });
    await expect(service.detach({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1', isAdmin: true,
      expectedVersion: 2,
    })).rejects.toMatchObject({ code: 'session_ended' });
  });

  it('should increment version monotonically on state transitions', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    const first = await service.attach(attachInput());
    expect(first.version).toBe(1);

    const detached = await service.detach({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1', isAdmin: false,
      expectedVersion: 1,
    });
    expect(detached.version).toBe(2);

    const reattached = await service.attach(attachInput({ workspaceId: 'workspace-2' }));
    expect(reattached.version).toBe(3);

    const ended = await service.end({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1', isAdmin: false,
      expectedVersion: 3,
    });
    expect(ended.version).toBe(4);
  });

  it('should prevent ABA detach race from overwriting a re-attached workspace', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput({ workspaceId: 'workspace-1', principalId: 'user-1' }));

    const originalFindBySession = store.findBySession.bind(store);
    let raceTriggered = false;
    store.findBySession = async (sessionId: string) => {
      const row = await originalFindBySession(sessionId);
      if (!raceTriggered && row?.status === 'attached' && row.workspaceId === 'workspace-1') {
        raceTriggered = true;
        await service.detach({
          sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1', isAdmin: false,
          expectedVersion: 1,
        });
        await service.attach(attachInput({
          workspaceId: 'workspace-2', principalId: 'user-2',
        }));
      }
      return row;
    };

    await expect(service.detach({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1', isAdmin: false,
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'workspace_rights_refused' });

    const current = await originalFindBySession('session-1');
    expect(current?.workspaceId).toBe('workspace-2');
    expect(current?.principalId).toBe('user-2');
    expect(current?.status).toBe('attached');
  });

  it('should reject compareAndSet when version does not match (ABA prevention)', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    const initial = await service.attach(attachInput());

    await service.detach({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1', isAdmin: false,
      expectedVersion: 1,
    });
    await service.attach(attachInput({ principalId: 'user-2' }));

    const staleCasResult = await store.compareAndSet(initial, {
      ...initial,
      status: 'detached',
    });
    expect(staleCasResult).toBe(false);
  });

  it('should reject compareAndSet on identical row attributes when version changed (pure ABA)', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    const initial = await service.attach(attachInput());

    await service.detach({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1', isAdmin: false,
      expectedVersion: 1,
    });
    await service.attach(attachInput());

    const staleCasResult = await store.compareAndSet(initial, {
      ...initial,
      status: 'detached',
    });
    expect(staleCasResult).toBe(false);
  });

  it('should compare the full CAS tuple through the production predicate', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    const initial = await service.attach(attachInput());
    await service.detach({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1', isAdmin: false,
      expectedVersion: 1,
    });
    const reattached = await service.attach(attachInput());
    expect(isExpectedBindingState(initial, initial)).toBe(true);
    // Pure ABA: same visible attributes, version moved on.
    expect(isExpectedBindingState(reattached, initial)).toBe(false);
    expect(isExpectedBindingState({ ...initial, status: 'detached' }, initial)).toBe(false);
    expect(isExpectedBindingState(null, initial)).toBe(false);
  });
});
