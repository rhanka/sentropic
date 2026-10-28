import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../src/db/client';
import { users, userSessions } from '../../../src/db/schema';
import { createSession, refreshSession, revokeAllSessions, revokeSession } from '../../../src/services/session-manager';
import { resolveRemoteLogin, reserveRemoteEvidence } from '../../../src/services/auth/remote-session';
import { createRemoteEvidenceIssuer } from '../../../src/services/auth/remote-evidence';

const keys = generateKeyPairSync('ed25519');
let userId: string;
let directory: string;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'rc1-login-'));
  vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
  vi.stubEnv('REMOTE_ACTION_SESSION_STATE_DIR', directory);
  userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `rc1-${userId}@example.test`,
    role: 'editor', emailVerified: true });
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
async function setup() {
  const tokens = await createSession(userId, 'editor', undefined, { mfaVerified: true });
  const login = (await resolveRemoteLogin(tokens.sessionToken))!;
  const issue = createRemoteEvidenceIssuer({ issuer: 'idp', kid: 'idp-1', key: keys.privateKey,
    now: Date.now, session: resolveRemoteLogin, reserve: reserveRemoteEvidence,
    approvedTarget: async (digest) => ({ audience: digest.startsWith('c') ? 'native-c' : 'native-b',
      tenantId: 'tenant', workspaceId: 'workspace' }) });
  const request = { version: 'remote-action-v1', kind: 'evidence-request', actionId: 'AAAAAAAAAAAAAAAAAAAAAA',
    targetDigest: 'a'.repeat(64), operation: 'input', payloadDigest: 'b'.repeat(64), nonceId: 'nonce',
    sid: login.sid, sessionVersion: login.sessionVersion, sessionCredential: tokens.sessionToken };
  return { tokens, login, request, issue };
}

describe('RC1 current issuer session store', () => {
  it('should refuse restored shared-DB authority after issuer logout', async () => {
    const { tokens, request, issue } = await setup();
    const [row] = await db.select().from(userSessions).where(eq(userSessions.id, tokens.sessionId));
    await revokeSession(tokens.sessionId);
    await db.insert(userSessions).values(row);
    await expect(issue(request)).rejects.toMatchObject({ code: 'authentication_required' });
  });
  it('should preserve sid/version/auth_time/MFA across credential refresh and fresh actions', async () => {
    const { tokens, login, request, issue } = await setup();
    const first = decodeJwt(await issue(request));
    const refreshed = (await refreshSession(tokens.refreshToken))!;
    const current = (await resolveRemoteLogin(refreshed.sessionToken))!;
    expect(current.sid).toBe(login.sid);
    expect(current.sessionVersion).toBe(login.sessionVersion);
    expect(current.authTime).toBe(login.authTime);
    const next = decodeJwt(await issue({ ...request, actionId: 'BBBBBBBBBBBBBBBBBBBBBA',
      targetDigest: 'c'.repeat(64), sessionCredential: refreshed.sessionToken }));
    expect(next.auth_time).toBe(first.auth_time);
    expect(next.amr).toEqual(first.amr);
    expect(next.aud).toBe('native-c');
    expect(await resolveRemoteLogin(tokens.sessionToken)).toBeNull();
  });
  it.each(['logout', 'revoke-all', 'expiry', 'version'])('should refuse %s from authoritative state', async (reason) => {
    const { tokens, request, issue } = await setup();
    if (reason === 'logout') await revokeSession(tokens.sessionId);
    if (reason === 'revoke-all') await revokeAllSessions(userId);
    if (reason === 'expiry') await db.update(userSessions).set({ expiresAt: new Date(0) })
      .where(eq(userSessions.id, tokens.sessionId));
    if (reason === 'version') await db.update(userSessions).set({ createdAt: new Date(0) })
      .where(eq(userSessions.id, tokens.sessionId));
    await expect(issue(request)).rejects.toMatchObject({ code: 'authentication_required' });
  });
  it('should refuse a single-factor session and durable repeated issuance', async () => {
    const bearer = await createSession(userId, 'editor');
    expect(await resolveRemoteLogin(bearer.sessionToken)).toBeNull();
    const { request, issue } = await setup();
    await issue(request);
    await expect(issue(request)).rejects.toMatchObject({ code: 'replay_refused' });
  });
});
