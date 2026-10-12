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
  };
};

const attachInput = (overrides = {}) => ({
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
  sessionTenantId: 'tenant-a',
  workspaceTenantId: 'tenant-a',
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
    const detached = await service.detach('session-1');
    expect(detached.status).toBe('detached');
    expect(detached.workspaceId).toBe('workspace-1');
    const reattached = await service.attach(attachInput({ workspaceId: 'workspace-2' }));
    expect(reattached.status).toBe('attached');
  });

  it('should keep the workspace ref after end and forbid reuse', async () => {
    const store = memoryStore();
    const service = createSessionWorkspaceBindingService(store);
    await service.attach(attachInput());
    const ended = await service.end('session-1');
    expect(ended.status).toBe('ended');
    expect(ended.workspaceId).toBe('workspace-1');
    await expect(service.attach(attachInput())).rejects.toMatchObject({ code: 'session_ended' });
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
    await expect(after.get('session-1')).resolves.toMatchObject({
      sessionId: 'session-1', workspaceId: 'workspace-1', status: 'attached',
    });
  });
});
