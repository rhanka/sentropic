import { describe, expect, it, vi } from 'vitest';
import { createBoundaryDomain, TenantBoundaryError } from '../src/index.js';

describe('tenant boundaries', () => {
  it('should derive tid from an approved membership and hash the workspace reference', async () => {
    const resolveApproved = vi.fn(async () => ({
      tenantId: 'tenant-acme',
      userId: 'user-1',
      status: 'approved' as const,
    }));
    const boundaries = createBoundaryDomain({
      homeNodeId: 'node:sentropic-local',
      memberships: { resolveApproved },
    });

    const context = await boundaries.resolve({ workspaceId: 'workspace-1', userId: 'user-1' });

    expect(resolveApproved).toHaveBeenCalledWith({ workspaceId: 'workspace-1', userId: 'user-1' });
    expect(context).toMatchObject({
      tid: 'tenant-acme',
      userId: 'user-1',
      homeNodeId: 'node:sentropic-local',
    });
    expect(context.workspace).toMatch(/^ws:sha256:[a-f0-9]{64}$/);
    expect(context.workspace).not.toContain('workspace-1');
  });

  it('should fail closed without a validated membership instead of using the workspace id', async () => {
    const boundaries = createBoundaryDomain({
      homeNodeId: 'node:sentropic-local',
      memberships: { async resolveApproved() { return null; } },
    });

    await expect(
      boundaries.resolve({ workspaceId: 'workspace-fallback', userId: 'user-1' }),
    ).rejects.toBeInstanceOf(TenantBoundaryError);
  });

  it('should create a deterministic opaque workspace reference', async () => {
    const boundaries = createBoundaryDomain({
      homeNodeId: 'node:sentropic-local',
      memberships: { async resolveApproved() { return null; } },
    });

    await expect(boundaries.workspaceReference('workspace-1')).resolves.toBe(
      await boundaries.workspaceReference('workspace-1'),
    );
  });
});
