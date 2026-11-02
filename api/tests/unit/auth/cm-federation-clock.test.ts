import { expect, it, vi } from 'vitest';
import { createCmFederationCompletion } from '../../../src/services/identity/cm-federation-completion';

const harness = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('../../../src/services/identity/cm-auth-runtime', () => ({
  withAppCmAuth: (operation: (runner: unknown) => Promise<unknown>) => operation(harness),
}));

it('reads the current clock after a subject-lock wait within the same attempt', async () => {
  let clock = new Date('2026-11-01T00:00:00Z');
  harness.complete.mockImplementation(async (_flow, operation) => ({ committed: true,
    value: await operation({
      ports: { clock: { now: () => clock }, federation: {}, auditLog: {} },
      sessions: { validateSessionToken: async () => ({ user: { id: 'actor' } }) },
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
