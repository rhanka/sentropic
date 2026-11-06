import { Hono } from 'hono';
import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';
import { beforeEach, expect, it, vi } from 'vitest';

const { authenticate, workspace, log } = vi.hoisted(() => ({
  authenticate: vi.fn(), workspace: vi.fn(), log: vi.fn(),
}));
vi.mock('../../../src/services/identity/cm-http-principal', () => ({
  authenticateCmHttpRequest: authenticate, publishCmAuthenticationRefusal: vi.fn(),
}));
vi.mock('../../../src/services/workspace-service', () => ({ ensureWorkspaceForUser: workspace }));
vi.mock('../../../src/services/workspace-access', () => ({}));
vi.mock('../../../src/logger', () => ({ logger: { error: log } }));
import { requireAuth } from '../../../src/middleware/auth';

beforeEach(() => { vi.resetAllMocks(); });
it.each(['authentication', 'workspace'].flatMap(stage =>
  ['custody', 'sqlstate', 'unrestricted'].map(kind => ({ stage, kind }))))
('logs only a typed code for $stage/$kind failures', async ({ stage, kind }) => {
  const sentinel = 'SENTINEL-private-credential-and-database-details';
  const failure = Object.assign(kind === 'custody'
    ? new IdentityCustodyErrorV1('identity_transaction_unbound') : new Error(sentinel), {
    cause: { message: sentinel, details: { credential: sentinel } }, detail: sentinel,
    ...(kind === 'custody' ? {} : { code: kind === 'sqlstate' ? '08006' : sentinel }),
  });
  failure.message = sentinel;
  if (stage === 'authentication') authenticate.mockRejectedValue(failure);
  else {
    authenticate.mockResolvedValue({ accepted: true, principal: {
      session: { userId: 'user', sessionId: 'session' }, role: 'editor',
    } });
    workspace.mockRejectedValue(failure);
  }
  const response = await new Hono().use('*', requireAuth).get('/private', c => c.text('ok')).request('/private');
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Authentication failed' });
  expect(log.mock.calls).toEqual([[{
    code: kind === 'custody' ? 'identity_transaction_unbound' : kind === 'sqlstate' ? '08006' : 'identity_host_failure',
    path: '/private',
  }, 'Authentication middleware error']]);
  expect(JSON.stringify(log.mock.calls)).not.toContain(sentinel);
});
