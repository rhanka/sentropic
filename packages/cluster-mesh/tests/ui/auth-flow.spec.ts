import { describe, expect, it, vi } from 'vitest';
import { createDefaultAuthUiLabels, createDefaultFetchTransport } from '@sentropic/auth-ui';
import { completeIdentityAuth, registrationScreenTransport, type IdentityAuthScreenPorts } from '../../ui/auth-flow.js';

const setup = () => {
  const fetch = vi.fn(async (_input: string, _init?: RequestInit) => Response.json({}));
  const events: string[] = [];
  const ports: IdentityAuthScreenPorts = { transport: createDefaultFetchTransport({ baseUrl: '/auth', fetch }),
    labels: createDefaultAuthUiLabels(), presentation: {}, loginHref: '/login', registerHref: '/register',
    commitSession: async () => { events.push('session'); }, navigate: async path => { events.push(path); },
    resumeOAuth: async continuation => { events.push(`oauth:${continuation}`); } };
  return { ports, events, fetch };
};
const session = { user: { id: 'person', email: 'person@example.test' } };

describe('CM authentication screen completion', () => {
  it.each(['//foreign.example', '/\t/foreign.example', '/\\foreign.example', 'https://foreign.example'])('refuses external return path %s', async path => {
    const { ports, events } = setup();
    await completeIdentityAuth({ ...ports, presentation: { returnPath: path } }, session);
    expect(events).toEqual(['session', '/neutral']);
  });
  it('commits the session before resuming the sealed OAuth continuation', async () => {
    const { ports, events } = setup();
    await completeIdentityAuth({ ...ports, presentation: { oauthContinuation: 'sealed', returnPath: '/ignored' } }, session);
    expect(events).toEqual(['session', 'oauth:sealed']);
  });
  it('publishes no navigation after a failed session projection', async () => {
    const { ports, events } = setup();
    await expect(completeIdentityAuth({ ...ports, commitSession: async () => { throw Error('unavailable'); } }, session)).rejects.toThrow();
    expect(events).toEqual([]);
  });
  it('carries the continuation as presentation to the real registration transport', async () => {
    const { ports, fetch } = setup();
    const transport = registrationScreenTransport({ ...ports, presentation: { oauthContinuation: 'sealed' } });
    await transport.createPasskeyRegistrationOptions({ email: session.user.email, verificationToken: 'ticket' });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ oauthContinuation: 'sealed', verificationToken: 'ticket' });
  });
});
