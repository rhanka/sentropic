import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { cmMemberPorts } from '../../../src/routes/namespaces/workspaces/cm-member-ports';

const dependencies = vi.hoisted(() => ({ change: vi.fn(), notify: vi.fn(), warn: vi.fn() }));
vi.mock('../../../src/services/identity/cm-workspace-members', () => ({
  changeCmWorkspaceMember: dependencies.change, listCmWorkspaceMemberViews: vi.fn(),
  CmWorkspaceMembershipPolicyError: class extends Error {},
}));
vi.mock('../../../src/services/identity/cm-deletion-authorization', () => ({
  CmIdentityForbiddenError: class extends Error {},
}));
vi.mock('../../../src/services/workspace-provisioning', () => ({ notifyWorkspaceMembershipEvent: dependencies.notify }));
vi.mock('../../../src/logger', () => ({ logger: { warn: dependencies.warn } }));

const app = () => new Hono().use('*', async (c, next) => {
  c.set('user', { userId: 'actor' });
  await next();
}).post('/workspaces/:id/members', ...cmMemberPorts.addMember!);
const request = () => app().request('/workspaces/workspace/members', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'member@example.test', role: 'viewer' }),
});

describe('committed membership HTTP response', () => {
  beforeEach(() => vi.resetAllMocks());
  it('preserves success when a post-commit realtime notification fails', async () => {
    dependencies.change.mockResolvedValue({ userId: 'member', changed: true });
    dependencies.notify.mockRejectedValue(new Error('notification transport unavailable'));
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(dependencies.notify).toHaveBeenCalledOnce();
    expect(dependencies.warn).toHaveBeenCalledOnce();
  });
  it('reports a failed mutation and emits no notification', async () => {
    dependencies.change.mockRejectedValue(new Error('transaction rolled back'));
    expect((await request()).status).toBe(503);
    expect(dependencies.notify).not.toHaveBeenCalled();
  });
});
