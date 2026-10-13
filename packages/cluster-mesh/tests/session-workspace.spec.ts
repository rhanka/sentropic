import { describe, expect, it } from 'vitest';
import {
  createSessionWorkspaceBindingService,
  type SessionWorkspaceBinding,
  type SessionWorkspaceBindingStore,
} from '../src/sessions/workspace-binding.js';

const memoryStore = (): SessionWorkspaceBindingStore & { rows: Map<string, SessionWorkspaceBinding> } => {
  const rows = new Map<string, SessionWorkspaceBinding>();
  return {
    rows,
    async findBySession(sessionId: string) { return rows.get(sessionId) ?? null; },
    async save(binding: SessionWorkspaceBinding) { rows.set(binding.sessionId, binding); },
    async compareAndSet(current: SessionWorkspaceBinding | null, next: SessionWorkspaceBinding) {
      const existing = rows.get(next.sessionId) ?? null;
      if (current === null) {
        if (existing) return false;
        rows.set(next.sessionId, next);
        return true;
      }
      if (!existing || existing.status !== current.status) return false;
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
    })).rejects.toMatchObject({ code: 'workspace_rights_refused' });
    const detached = await service.detach({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-2', isAdmin: true,
    });
    expect(detached.status).toBe('detached');
  });

  it('should enforce rights on end: refuse unauthorized caller, allow owner and admin', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput({ principalId: 'user-1' }));
    await expect(service.end({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-2', isAdmin: false,
    })).rejects.toMatchObject({ code: 'workspace_rights_refused' });
    const ended = await service.end({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-2', isAdmin: true,
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
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1',
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
      principalId: undefined as unknown as string, isAdmin: false,
    })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('should refuse end when principal is omitted', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput());
    await expect(service.end({
      sessionId: 'session-1', tenantId: 'tenant-a',
      principalId: undefined as unknown as string, isAdmin: false,
    })).rejects.toMatchObject({ code: 'invalid_request' });
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
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1',
    })).resolves.toMatchObject({
      sessionId: 'session-1', workspaceId: 'workspace-1', status: 'attached',
    });
  });

  it('should hide cross-tenant bindings as binding_not_found on attach', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput());
    await expect(service.attach(attachInput({ sessionTenantId: 'tenant-b', workspaceTenantId: 'tenant-b' })))
      .rejects.toMatchObject({ code: 'binding_not_found' });
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
    });
    await expect(service.detach({
      sessionId: 'session-1', tenantId: 'tenant-a', principalId: 'user-1', isAdmin: true,
    })).rejects.toMatchObject({ code: 'session_ended' });
  });
});
