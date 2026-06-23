import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { db } from '../../../src/db/client';
import { authInviteTokens, users } from '../../../src/db/schema';
import { createInviteStoreAdapter, hashInviteToken } from '../../../src/services/auth/invite-store-adapter';

/**
 * BR-39r L4 — single-use invitation-token store.
 * Covers the validity matrix (valid / unknown / expired / consumed / email-mismatch read via
 * findValid) and the single-use concurrency guarantee (two parallel consumes → exactly one winner).
 */

const adapter = createInviteStoreAdapter();
const userId = `invite-user-${randomUUID().slice(0, 8)}`;
const email = `invitee-${randomUUID().slice(0, 8)}@example.com`;

const future = () => new Date(Date.now() + 60 * 60 * 1000);
const past = () => new Date(Date.now() - 60 * 60 * 1000);

const seedInvite = async (input: {
  token: string;
  email: string;
  expiresAt: Date;
  consumedAt?: Date | null;
}): Promise<void> => {
  await db.insert(authInviteTokens).values({
    id: randomUUID(),
    tokenHash: hashInviteToken(input.token),
    email: input.email,
    clientId: null,
    expiresAt: input.expiresAt,
    consumedAt: input.consumedAt ?? null,
    consumedByUserId: null,
    createdAt: new Date(),
  });
};

describe('createInviteStoreAdapter (BR-39r L4 single-use invite tokens)', () => {
  beforeEach(async () => {
    await db.delete(authInviteTokens);
    await db.delete(users).where(eq(users.id, userId));
    await db.insert(users).values({
      createdAt: new Date(),
      displayName: 'Invitee',
      email,
      emailVerified: true,
      id: userId,
      role: 'editor',
      updatedAt: new Date(),
    });
  });

  afterEach(async () => {
    await db.delete(authInviteTokens);
    await db.delete(users).where(eq(users.id, userId));
  });

  it('findValid returns the bound email for a valid (unconsumed, unexpired) token', async () => {
    const token = 'sit_valid_token';
    await seedInvite({ token, email, expiresAt: future() });

    const result = await adapter.findValid(hashInviteToken(token), new Date());
    expect(result).toEqual({ clientId: null, email });
  });

  it('findValid returns null for an unknown token (no enumeration distinction)', async () => {
    const result = await adapter.findValid(hashInviteToken('sit_unknown'), new Date());
    expect(result).toBeNull();
  });

  it('findValid returns null for an expired token', async () => {
    const token = 'sit_expired';
    await seedInvite({ token, email, expiresAt: past() });

    const result = await adapter.findValid(hashInviteToken(token), new Date());
    expect(result).toBeNull();
  });

  it('findValid returns null for an already-consumed token', async () => {
    const token = 'sit_already_consumed';
    await seedInvite({ token, email, expiresAt: future(), consumedAt: new Date() });

    const result = await adapter.findValid(hashInviteToken(token), new Date());
    expect(result).toBeNull();
  });

  it('email-mismatch is detected by the caller (findValid returns the BOUND email, not the requested one)', async () => {
    const token = 'sit_bound_other';
    await seedInvite({ token, email: 'someone-else@example.com', expiresAt: future() });

    const result = await adapter.findValid(hashInviteToken(token), new Date());
    // The store returns the bound email; the caller compares it to the requested email and
    // collapses any mismatch into the generic fallback (C3 — no distinct signal).
    expect(result?.email).toBe('someone-else@example.com');
    expect(result?.email).not.toBe(email);
  });

  it('consume returns the bound email exactly once and marks the row consumed (single-use)', async () => {
    const token = 'sit_consume_once';
    await seedInvite({ token, email, expiresAt: future() });
    const hash = hashInviteToken(token);

    const first = await adapter.consume(hash, new Date(), userId);
    expect(first).toEqual({ email });

    const second = await adapter.consume(hash, new Date(), userId);
    expect(second).toBeNull();

    const [row] = await db.select().from(authInviteTokens).where(eq(authInviteTokens.tokenHash, hash));
    expect(row.consumedAt).not.toBeNull();
    expect(row.consumedByUserId).toBe(userId);
  });

  it('consume on an expired token returns null (no consume)', async () => {
    const token = 'sit_consume_expired';
    await seedInvite({ token, email, expiresAt: past() });

    const result = await adapter.consume(hashInviteToken(token), new Date(), userId);
    expect(result).toBeNull();
  });

  it('two parallel consumes → EXACTLY ONE winner (single-use under concurrency)', async () => {
    const token = 'sit_race';
    await seedInvite({ token, email, expiresAt: future() });
    const hash = hashInviteToken(token);
    const now = new Date();

    const results = await Promise.all([
      adapter.consume(hash, now, userId),
      adapter.consume(hash, now, userId),
      adapter.consume(hash, now, userId),
    ]);

    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toEqual({ email });
  });
});
