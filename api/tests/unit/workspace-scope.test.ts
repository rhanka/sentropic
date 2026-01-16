import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/services/workspace-access', () => ({
  getWorkspaceRole: vi.fn(async (_userId: string, _workspaceId: string) => null),
}));

import { resolveReadableWorkspaceId } from '../../src/utils/workspace-scope';
import { ADMIN_WORKSPACE_ID } from '../../src/db/schema';
import { getWorkspaceRole } from '../../src/services/workspace-access';

describe('workspace-scope', () => {
  it('returns user workspace for non-admin regardless of requested', async () => {
    const resolved = await resolveReadableWorkspaceId({
      user: { role: 'editor', workspaceId: 'ws-user' },
      requested: 'ws-other',
    });
    expect(resolved).toBe('ws-user');
  });

  it('allows admin_app to use admin workspace id', async () => {
    const resolved = await resolveReadableWorkspaceId({
      user: { role: 'admin_app', workspaceId: 'ws-admin' },
      requested: ADMIN_WORKSPACE_ID,
    });
    expect(resolved).toBe(ADMIN_WORKSPACE_ID);
  });

  it('allows admin_app to use requested workspace if member', async () => {
    (getWorkspaceRole as any).mockResolvedValueOnce('viewer');
    const resolved = await resolveReadableWorkspaceId({
      user: { role: 'admin_app', workspaceId: 'ws-admin', userId: 'u-1' },
      requested: 'ws-shared',
    });
    expect(resolved).toBe('ws-shared');
  });

  it('rejects admin_app request when not member', async () => {
    (getWorkspaceRole as any).mockResolvedValueOnce(null);
    await expect(
      resolveReadableWorkspaceId({
        user: { role: 'admin_app', workspaceId: 'ws-admin', userId: 'u-1' },
        requested: 'ws-shared',
      })
    ).rejects.toThrow('Workspace not accessible');
  });
});
