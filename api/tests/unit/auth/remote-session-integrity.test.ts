import { eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../src/db/client';
import { users, userSessions } from '../../../src/db/schema';
import { createSession, refreshSession } from '../../../src/services/session-manager';

let userId: string;
beforeEach(async () => {
  userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `rc1-integrity-${userId}@example.test`,
    role: 'editor', emailVerified: true });
});
afterEach(async () => { await db.delete(users).where(eq(users.id, userId)); });
describe('RC1 issuer login integrity against product DB mutation', () => {
  it('should sign immutable MFA and lineage in both session and refresh credentials', async () => {
    const tokens = await createSession(userId, 'editor', undefined, { mfaVerified: true });
    const access = decodeJwt(tokens.sessionToken);
    const refresh = decodeJwt(tokens.refreshToken);
    expect(access.login).toMatchObject({ mfaVerified: true });
    expect(refresh.login).toEqual(access.login);
    expect(refresh.tokenUse).toBe('refresh');
  });
  it('should refuse refresh when DB writers elevate a single-factor login to MFA', async () => {
    const tokens = await createSession(userId, 'editor');
    await db.update(userSessions).set({ mfaVerified: true }).where(eq(userSessions.id, tokens.sessionId));
    expect(await refreshSession(tokens.refreshToken)).toBeNull();
  });
  it('should preserve signed login lineage across refresh and refuse a changed DB version', async () => {
    const tokens = await createSession(userId, 'editor', undefined, { mfaVerified: true });
    const current = (await refreshSession(tokens.refreshToken))!;
    expect(decodeJwt(current.sessionToken).login).toEqual(decodeJwt(tokens.sessionToken).login);
    await db.update(userSessions).set({ createdAt: new Date(0) }).where(eq(userSessions.id, tokens.sessionId));
    expect(await refreshSession(current.refreshToken)).toBeNull();
  });
});
