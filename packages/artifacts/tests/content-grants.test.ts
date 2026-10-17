/**
 * L-5d — content grants and activation tickets (spec-v8 §9 5d): short
 * signed grants (55s inside a 60s cutoff budget), single-use bound
 * tickets, fail-closed verification. Secrets and clocks are injected.
 */
import { describe, expect, it } from 'vitest';
import {
  CONTENT_CUTOFF_BUDGET_SECONDS,
  CONTENT_GRANT_TTL_SECONDS,
  createHmacGrantSigner,
  createMemoryTicketStore,
  createTicketService,
} from '../src/content/grants.js';

const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const RELEASE = '22222222-2222-4222-8222-222222222222';
const BINDING = { subjectId: 'steve', artifactId: ARTIFACT, releaseId: RELEASE, channel: 'stable' } as const;

function makeSigner(now = { t: T0 }) {
  return {
    now,
    signer: createHmacGrantSigner({ secret: 'test-grant-secret', clock: () => now.t }),
  };
}

describe('content grants', () => {
  it('keeps the grant TTL inside the measured cutoff budget', () => {
    expect(CONTENT_GRANT_TTL_SECONDS).toBe(55);
    expect(CONTENT_CUTOFF_BUDGET_SECONDS).toBe(60);
    expect(CONTENT_GRANT_TTL_SECONDS).toBeLessThan(CONTENT_CUTOFF_BUDGET_SECONDS);
  });

  it('issues and verifies a bound grant round-trip', () => {
    const { signer } = makeSigner();
    const token = signer.issue({ subjectId: 'steve', artifactId: ARTIFACT, releaseId: RELEASE });
    const claims = signer.verify(token);
    expect(claims).toMatchObject({
      subjectId: 'steve', artifactId: ARTIFACT, releaseId: RELEASE, scope: 'read',
    });
    expect(claims.expiresAt - claims.issuedAt).toBe(CONTENT_GRANT_TTL_SECONDS * 1000);
    const unbound = signer.issue({ subjectId: 'steve', artifactId: ARTIFACT });
    expect(signer.verify(unbound).releaseId).toBeUndefined();
  });

  it('refuses tampered, foreign and malformed grants', () => {
    const { signer } = makeSigner();
    const token = signer.issue({ subjectId: 'steve', artifactId: ARTIFACT });
    const [payload, signature] = token.split('.') as [string, string];
    const forgedPayload = Buffer.from(JSON.stringify({
      subjectId: 'mallory', artifactId: ARTIFACT, scope: 'read',
      issuedAt: T0, expiresAt: T0 + 55_000,
    })).toString('base64url');
    expect(() => signer.verify(`${forgedPayload}.${signature}`)).toThrow(/invalid grant/);
    expect(() => signer.verify(`${payload}.${'A'.repeat(43)}`)).toThrow(/invalid grant/);
    const foreign = createHmacGrantSigner({ secret: 'other-secret', clock: () => T0 });
    expect(() => signer.verify(foreign.issue({ subjectId: 'steve', artifactId: ARTIFACT })))
      .toThrow(/invalid grant/);
    expect(() => signer.verify('not-a-token')).toThrow(/invalid grant/);
    expect(() => signer.verify('')).toThrow(/invalid grant/);
  });

  it('refuses expired grants and grants issued in the future', () => {
    const { signer, now } = makeSigner();
    const token = signer.issue({ subjectId: 'steve', artifactId: ARTIFACT });
    now.t = T0 + 56_000;
    expect(() => signer.verify(token)).toThrow(/grant expired/);
    now.t = T0 - 10_000;
    expect(() => signer.verify(token)).toThrow(/invalid grant/);
  });

  it('redeems a ticket exactly once, bound to subject and artifact', async () => {
    const now = { t: T0 };
    let seq = 0;
    const tickets = createTicketService({
      store: createMemoryTicketStore(),
      clock: () => now.t,
      ids: () => `ticket-${(seq += 1)}`,
    });
    const issued = await tickets.issue(BINDING);
    expect(issued.ticketId).toBe('ticket-1');
    await expect(tickets.redeem(issued.ticketId, { ...BINDING, subjectId: 'mallory' }))
      .rejects.toThrow(/invalid ticket/);
    const redeemed = await tickets.redeem(issued.ticketId, BINDING);
    expect(redeemed).toMatchObject({ subjectId: 'steve', artifactId: ARTIFACT, releaseId: RELEASE });
    await expect(tickets.redeem(issued.ticketId, BINDING))
      .rejects.toThrow(/invalid ticket/);
    await expect(tickets.redeem('ticket-404', BINDING))
      .rejects.toThrow(/invalid ticket/);
  });

  it('refuses expired tickets', async () => {
    const now = { t: T0 };
    const tickets = createTicketService({
      store: createMemoryTicketStore(),
      clock: () => now.t,
      ids: () => 'ticket-x',
    });
    const issued = await tickets.issue(BINDING);
    now.t = issued.expiresAt + 1;
    await expect(tickets.redeem(issued.ticketId, BINDING))
      .rejects.toThrow(/ticket expired/);
  });
});
