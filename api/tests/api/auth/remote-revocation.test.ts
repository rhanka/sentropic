import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../src/db/client';
import { users, userSessions } from '../../../src/db/schema';
import { createSession, revokeSession, revokeAllSessions } from '../../../src/services/session-manager';
import { getRemoteSessionAuthority } from '../../../src/services/auth/remote-private-session';
import { resolveRemoteLogin } from '../../../src/services/auth/remote-session';
import { createJwksAdapter } from '../../../src/services/auth/jwks-adapter';
import { getSentropicOAuthPorts } from '../../../src/routes/auth/oauth';
import { createIdpApp } from '../../../../apps/auth-idp/idp-app';

const issuer = 'https://idp.example.test', resource = `${issuer}/remote-revocation`;
const clientId = 'test-product-revoker', path = '/api/v1/auth/session/remote-revocations';
let userId: string, directory: string;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'rc1-product-revoke-'));
  vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
  vi.stubEnv('REMOTE_ACTION_SESSION_STATE_DIR', directory);
  vi.stubEnv('OAUTH_ISSUER_URL', issuer);
  vi.stubEnv('REMOTE_ACTION_REVOCATION_ISSUER', issuer);
  vi.stubEnv('REMOTE_ACTION_REVOCATION_CLIENT_ID', clientId);
  vi.stubEnv('REMOTE_ACTION_REVOCATION_CLIENT_SECRET', crypto.randomUUID());
  vi.stubEnv('REMOTE_ACTION_REVOCATION_RESOURCE', resource);
  userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, emailVerified: true, role: 'editor' });
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});
async function bearer(change: Record<string, unknown> = {}) {
  const key = await createJwksAdapter().generateAndStoreNewKey();
  return new SignJWT({ iss: issuer, aud: resource, sub: clientId, client_id: clientId,
    scope: 'remote.sessions.revoke', exp: Math.floor(Date.now() / 1000) + 60, ...change })
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid }).sign(key.privateKey!);
}
describe('RC1 product to issuer revocation', () => {
  it.each(['logout', 'revoke-all', 'oauth-logout', 'oauth-revoke-all'])
  ('should persist issuer tombstones for product %s before returning', async operation => {
    const tokens = await createSession(userId, 'editor', undefined, { mfaVerified: true });
    const [row] = await db.select().from(userSessions).where(eq(userSessions.id, tokens.sessionId));
    const token = await bearer(), idp = createIdpApp();
    const transport = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/oauth/token')) {
        expect(new URLSearchParams(String(init.body)).get('scope')).toBe('remote.sessions.revoke');
        return Response.json({ access_token: token, token_type: 'Bearer' });
      }
      expect(url).toBe(`${issuer}${path}`);
      vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
      try { return await idp.request(url, init); }
      finally { vi.stubEnv('REMOTE_ACTION_ROLE', 'product'); }
    });
    vi.stubGlobal('fetch', transport);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    if (operation === 'logout') await revokeSession(tokens.sessionId);
    if (operation === 'revoke-all') await revokeAllSessions(userId);
    if (operation === 'oauth-logout') await getSentropicOAuthPorts().sessions.revoke(tokens.sessionId);
    if (operation === 'oauth-revoke-all') await getSentropicOAuthPorts().sessions.revokeAllForUser(userId);
    expect(transport).toHaveBeenCalledTimes(2);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    expect(getRemoteSessionAuthority()!.find(tokens.sessionId)?.revoked).toBe(true);
    await db.insert(userSessions).values(row);
    expect(await resolveRemoteLogin(tokens.sessionToken)).toBeNull();
  });
  it.each([{ scope: 'remote.evidence.issue' }, { aud: 'other' }, { client_id: 'other' },
    { sub: 'user' }, { cnf: { jkt: 'bound-token' } }, { exp: 1 }])
  ('should refuse unauthorized revocation claims %j', async change => {
    const token = await bearer(change);
    const result = await createIdpApp().request(`${issuer}${path}`, { method: 'POST',
      headers: { authorization: `Bearer ${token}` }, body: 'invalid' });
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ error: 'authentication_required' });
  });
  it('should delete the DB session even when issuer delivery fails', async () => {
    const tokens = await createSession(userId, 'editor', undefined, { mfaVerified: true });
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    await expect(revokeSession(tokens.sessionId)).rejects.toMatchObject({ code: 'authority_unavailable' });
    expect(await db.select().from(userSessions).where(eq(userSessions.id, tokens.sessionId))).toEqual([]);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    expect(await resolveRemoteLogin(tokens.sessionToken)).toBeNull();
  });
});
