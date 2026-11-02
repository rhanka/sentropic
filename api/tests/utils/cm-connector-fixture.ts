import { and, eq } from 'drizzle-orm';
import { expect, vi } from 'vitest';
import { db } from '../../src/db/client';
import { documentConnectorAccounts } from '../../src/db/schema';
import { storeGoogleDriveTokenMaterial } from '../../src/services/google-drive-connector-accounts';
import type { TestUser } from './auth-helper';

/** Capture the actual revocation capability sent by the CM delivery worker. */
export function captureConnectorRevocations() {
  const tokens: string[] = [], original = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === 'https://oauth2.googleapis.com/revoke') {
      tokens.push(new URLSearchParams(String(init?.body ?? '')).get('token') ?? '');
      return new Response(null, { status: 200 });
    }
    return original(input, init);
  }));
  return tokens;
}

/** Real encryption and connector persistence; unique identities keep fixtures isolated. */
export async function createCmConnectorFixture(user: TestUser) {
  const accountSubject = crypto.randomUUID(), refreshToken = `refresh-${accountSubject}`;
  const now = new Date();
  await storeGoogleDriveTokenMaterial({ userId: user.id, workspaceId: user.workspaceId!,
    identity: { accountEmail: `${accountSubject}@example.com`, accountSubject },
    token: { accessToken: `access-${accountSubject}`, refreshToken, idToken: `id-${accountSubject}`,
      tokenType: 'Bearer', expiresIn: 3600, scope: 'https://www.googleapis.com/auth/drive.file',
      scopes: ['https://www.googleapis.com/auth/drive.file'], obtainedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString() } });
  const [row] = await db.select().from(documentConnectorAccounts).where(and(
    eq(documentConnectorAccounts.userId, user.id), eq(documentConnectorAccounts.accountSubject, accountSubject)));
  expect(row?.tokenSecret).toBeTruthy();
  expect(row.tokenSecret).not.toContain(refreshToken);
  return { accountId: row.id, refreshToken, ciphertext: row.tokenSecret! };
}

export const findConnectorFixture = (id: string) => db.select().from(documentConnectorAccounts)
  .where(eq(documentConnectorAccounts.id, id));
