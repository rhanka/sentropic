import { expect, it, vi } from 'vitest';
import { createCmFederationCompletion } from '../../../src/services/identity/cm-federation-completion';

const harness = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('../../../src/services/identity/cm-auth-runtime', () => ({
  withAppCmAuth: (operation: (runner: unknown) => Promise<unknown>) => operation(harness),
}));
const sessionPorts = (clock: () => Date, allowed = true) => ({
  clock: { now: clock }, federation: {}, auditLog: {},
  cookies: { readSessionToken: (request: Request) => request.headers.get('cookie')?.slice('session='.length) },
  tokens: { verifySessionToken: async () => ({ userId: 'actor', sessionId: 'login' }), hashSecret: async () => 'digest' },
  sessions: { findByTokenHash: async () => ({ id: 'login', userId: 'actor', revokedAt: null,
    expiresAt: new Date('2026-11-01T01:00:00Z') }), touch: vi.fn() },
  users: { findById: async () => ({ id: 'actor' }) },
  accountPolicy: { canAuthenticate: async () => ({ allowed }) },
});

it('reads the current clock after a subject-lock wait within the same attempt', async () => {
  let clock = new Date('2026-11-01T00:00:00Z');
  harness.complete.mockImplementation(async (_flow, operation) => ({ committed: true,
    value: await operation({
      ports: sessionPorts(() => clock),
      sessions: { validateSessionToken: () => { throw new Error('Nested completion must not run'); } },
    }, { lockSubject: async () => { clock = new Date('2026-11-01T00:01:00Z'); } }),
  }));
  const result = await createCmFederationCompletion('session')(async attempt => {
    const before = attempt.now;
    await attempt.requireLinkActor('actor');
    return { before, after: attempt.now };
  });
  expect(result.before.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  expect(result.after.toISOString()).toBe('2026-11-01T00:01:00.000Z');
});

it('refuses a disabled manual-link actor without invoking another completion flow', async () => {
  const validate = vi.fn(() => { throw new Error('Nested completion must not run'); });
  harness.complete.mockImplementation(async (_flow, operation) => ({ committed: true,
    value: await operation({ ports: sessionPorts(() => new Date('2026-11-01T00:00:00Z'), false),
      sessions: { validateSessionToken: validate } }, { lockSubject: vi.fn() }),
  }));
  await expect(createCmFederationCompletion('session')(attempt => attempt.requireLinkActor('actor')))
    .rejects.toMatchObject({ status: 401, code: 'authentication_required' });
  expect(validate).not.toHaveBeenCalled();
});
