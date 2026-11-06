import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../src/app';
import { db, pool } from '../../../src/db/client';
import { withOAuthRefreshTransactionObserver } from '../../../src/services/auth/oauth-refresh-adapter';
import { revokeCmOAuthConsent } from '../../../src/services/auth/consent-store-adapter';
import { withAppCmAuth } from '../../../src/services/identity/cm-auth-runtime';
import { idTokenSigningKeys, oauthClients, oauthConsents } from '../../../src/db/schema';
import { updateCmUser } from '../../../src/services/identity/cm-users';
import { listCmSessionsForUser } from '../../../src/services/identity/cm-sessions';
import { createJwksAdapter } from '../../../src/services/auth/jwks-adapter';
import { revokeAllSessions, revokeSession } from '../../../src/services/session-manager';
import { setCmMembershipState } from '../../../src/services/identity/cm-tenancy';
import { PLATFORM_TENANT_ID } from '../../../src/services/workspace-service';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';
import { cmQuery, cmTable } from '../../utils/cm-identity-test-store';

// Session revocation goes through the CM-backed facade now (the host ports
// bag carries protocol configuration only); revoking also queues the CM
// revocation outbox intent for the sweep.
const revokeCmSession = (sessionId: string): Promise<void> => revokeSession(sessionId);
const revokeAllCmSessions = (userId: string): Promise<void> => revokeAllSessions(userId);

const base = 'http://localhost:9197/api/v1/oauth';
const clientId = 'refresh-integration';
const verifier = 'refresh-integration-pkce-verifier-256-bits';
let cookie = '';
let userId = '';
const post = (endpoint: string, values: Record<string, string>) => app.request(`${base}/${endpoint}`, {
  method: 'POST', body: new URLSearchParams({ client_id: clientId, ...values }),
  headers: { 'content-type': 'application/x-www-form-urlencoded', Cookie: cookie },
});
const authorize = () => app.request(`${base}/authorize?${new URLSearchParams({
  client_id: clientId, response_type: 'code', redirect_uri: 'https://client.test/callback',
  code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  scope: 'openid offline_access', resource: 'https://immo.test/mcp',
})}`, { headers: { Cookie: cookie } });
const obtainCode = async () => {
  const auth = await authorize();
  const location = new URL(auth.headers.get('location')!);
  let code = location.searchParams.get('code');
  if (!code) {
    const approval = await post('consent/decision', { decision: 'approve', state: location.searchParams.get('state')! });
    expect(approval.status).toBe(302);
    code = new URL(approval.headers.get('location')!).searchParams.get('code');
  }
  return code!;
};
const exchangeCode = (code: string) => post('token', { grant_type: 'authorization_code', code,
  code_verifier: verifier, redirect_uri: 'https://client.test/callback' });
const issue = async () => {
  const response = await exchangeCode(await obtainCode());
  expect(response.status).toBe(200);
  return response.json();
};

describe('host OAuth refresh HTTP integration', () => {
  beforeEach(async () => {
    await db.insert(oauthClients).values({ id: clientId, clientId, name: 'Refresh integration',
      redirectUris: ['https://client.test/callback'], allowedScopes: ['openid', 'offline_access'],
      resourceIndicators: ['https://immo.test/mcp'], grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'none', requirePkce: true });
    const user = await createTestUser({ withSession: true, withWorkspace: false, role: 'editor' });
    userId = user.id; cookie = `session=${user.sessionToken}`;
    // The offline flows resolve the authorize tenant from the user's approved
    // memberships (exactly one, so no selector); without it the cutover
    // refuses tenant-less offline grants fail-closed.
    await cmQuery(`INSERT INTO ${cmTable('cm_tenants')} (tenant_id, slug, status, created_at)
      VALUES ($1, $1, 'active', $2) ON CONFLICT (tenant_id) DO NOTHING`, [PLATFORM_TENANT_ID, new Date().toISOString()]);
    await setCmMembershipState(userId, PLATFORM_TENANT_ID, { status: 'approved', role: 'member', decidedBy: userId });
    const keys = createJwksAdapter();
    if (!await keys.getActiveKey()) await keys.generateAndStoreNewKey({ kid: 'refresh-integration-kid' });
  });
  afterEach(async () => {
    await db.delete(oauthClients).where(eq(oauthClients.clientId, clientId));
    await cleanupAuthData();
  });
  it('should advertise refresh only for an opted-in client through both host discovery endpoints', async () => {
    for (const path of ['openid-configuration', 'oauth-authorization-server']) {
      const url = `http://localhost:9197/.well-known/${path}`;
      const eligible = await app.request(`${url}?client_id=${clientId}`);
      expect(eligible.status).toBe(200);
      expect((await eligible.json()).grant_types_supported).toContain('refresh_token');
      for (const query of ['', '?client_id=unknown-client']) {
        const denied = await app.request(`${url}${query}`);
        expect(denied.status).toBe(200);
        expect((await denied.json()).grant_types_supported).not.toContain('refresh_token');
      }
    }
  });

  it('should authorize, consent, rotate twice and revoke the entire family through a spent token', async () => {
    const initial = await issue();
    expect(initial.expires_in).toBe(3600);
    const secondResponse = await post('token', { grant_type: 'refresh_token', refresh_token: initial.refresh_token });
    expect(secondResponse.status).toBe(200);
    const second = await secondResponse.json();
    const thirdResponse = await post('token', { grant_type: 'refresh_token', refresh_token: second.refresh_token });
    expect(thirdResponse.status).toBe(200);
    const third = await thirdResponse.json();
    expect((await post('introspect', { token: third.refresh_token })).status).toBe(200);
    expect((await post('revoke', { token: initial.refresh_token })).status).toBe(200);
    const { rows } = await pool.query(`SELECT count(*)::int AS count FROM oauth_tokens t
      LEFT JOIN revoked_tokens r ON r.jti=t.jti
      WHERE t.user_id=$1 AND t.expires_at > now() AND r.jti IS NULL`, [userId]);
    expect(rows[0].count).toBe(0);
    expect((await post('token', { grant_type: 'refresh_token', refresh_token: third.refresh_token })).status).toBe(400);
  });

  it('should revoke the committed successor when concurrent HTTP refresh retries reuse its parent', async () => {
    const initial = await issue();
    const responses = await Promise.all([0, 1].map(() => post('token', {
      grant_type: 'refresh_token', refresh_token: initial.refresh_token,
    })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    const successor = await responses.find((response) => response.status === 200)!.json();
    expect(await (await post('introspect', { token: successor.refresh_token })).json()).toEqual({ active: false });
    expect((await post('token', { grant_type: 'refresh_token', refresh_token: successor.refresh_token })).status).toBe(400);
    const { rows } = await pool.query(`SELECT count(*)::int AS count FROM oauth_tokens t
      LEFT JOIN revoked_tokens r ON r.jti=t.jti WHERE t.user_id=$1 AND t.expires_at > now() AND r.jti IS NULL`, [userId]);
    expect(rows[0].count).toBe(0);
  });

  it('should roll back code consumption and family creation when signing fails', async () => {
    const code = await obtainCode();
    // Signing reads the JWKS row per attempt; removing it fails issuance
    // closed. (Overriding the host-bag transaction no longer reaches the
    // per-attempt binding ports.)
    await db.delete(idTokenSigningKeys);
    const failed = await exchangeCode(code);
    expect(failed.status).toBe(503);
    // Attempt-wrapped routes mask issuance failures by design (the packaged
    // temporarily_unavailable contract cannot surface through the wrapper).
    expect(await failed.json()).toMatchObject({ error: { code: 'identity_unavailable' } });
    const { rows } = await pool.query('SELECT count(*)::int AS count FROM oauth_refresh_tokens WHERE user_id=$1', [userId]);
    expect(rows[0].count).toBe(0);
    await createJwksAdapter().generateAndStoreNewKey({ kid: 'refresh-integration-kid' });
    expect((await exchangeCode(code)).status).toBe(200);
  });

  it.each(['account', 'consent', 'security'])('should invalidate %s authority without restoration revival', async (kind) => {
    const initial = await issue();
    if (kind === 'account') {
      await updateCmUser(userId, { accountStatus: 'disabled_by_admin' });
      await updateCmUser(userId, { accountStatus: 'active' });
    } else if (kind === 'consent') await db.delete(oauthConsents).where(eq(oauthConsents.userId, userId));
    else {
      // Security-event revocation on the cluster-mesh path: the OAuth family is
      // revoked and every CM login session is revoked + queued to the CM
      // revocation outbox (replaces the deleted remote-revocation-outbox).
      await pool.query(`SELECT oauth_refresh_revoke_user($1, 'security_event')`, [userId]);
      await revokeAllCmSessions(userId);
    }
    expect((await post('token', { grant_type: 'refresh_token', refresh_token: initial.refresh_token })).status).toBe(400);
  });

  it('should preserve consented offline authority after a local browser logout', async () => {
    const initial = await issue();
    const [{ id: sessionId }] = await listCmSessionsForUser(userId);
    // Local browser logout on the cluster-mesh path: the CM login session is
    // revoked + queued to the CM revocation outbox while the consented offline
    // family survives (replaces the deleted remote-revocation-outbox).
    await revokeCmSession(sessionId);
    expect((await post('token', { grant_type: 'refresh_token', refresh_token: initial.refresh_token })).status).toBe(200);
  });

  for (const { kind, order } of ['consent', 'security'].flatMap((kind) => ['mint-first', 'revoke-first'].map((order) => ({ kind, order })))) {
  it
  (`should serialize initial family creation with ${kind}: ${order}`, async () => {
    const code = await obtainCode();
    const writer = revocationWriter(kind);
    let release = () => {};
    try {
      const writerPid = await writer.pid;
      if (order === 'revoke-first') {
        await writer.mutate();
        const pending = exchangeCode(code);
        await waitForBlocker(writerPid);
        await writer.commit();
        expect((await pending).status).toBe(400);
      } else {
        let entered!: () => void;
        const locked = new Promise<void>((resolve) => { entered = resolve; });
        const barrier = new Promise<void>((resolve) => { release = resolve; });
        const pending = withOAuthRefreshTransactionObserver(async () => {
          entered(); await barrier;
        }, () => exchangeCode(code));
        await locked;
        const revocation = writer.mutate();
        // The owning transaction's user lock is visible as the writer's blocker.
        for (let attempt = 0; attempt < 500; attempt++) {
          const { rows } = await pool.query('SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND cardinality(pg_blocking_pids(pid)) > 0', [writerPid]);
          if (rows.length) break;
          if (attempt === 499) throw new Error('Initial issuance lock barrier not reached.');
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        release(); expect((await pending).status).toBe(200);
        await revocation; await writer.commit();
      }
      const { rows } = await pool.query('SELECT count(*)::int AS count FROM oauth_refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
      expect(rows[0].count).toBe(0);
    } finally {
      release();
      await writer.close();
    }
  });
  }
});

function revocationWriter(kind: string) {
  let ready!: (pid: number) => void, begin!: () => void, applied!: () => void, finish!: () => void;
  const pid = new Promise<number>(resolve => { ready = resolve; });
  const mutation = new Promise<void>(resolve => { begin = resolve; });
  const mutated = new Promise<void>(resolve => { applied = resolve; });
  const commit = new Promise<void>(resolve => { finish = resolve; });
  const done = withAppCmAuth(runner => runner.request(async (_binding, tx) => {
    const { rows: [{ pid: backendPid }] } = await tx.hostTransaction.query('SELECT pg_backend_pid() AS pid');
    ready(backendPid);
    await mutation;
    if (kind === 'consent') await revokeCmOAuthConsent({ userId, clientId, tenantId: PLATFORM_TENANT_ID });
    else await tx.hostTransaction.query("SELECT oauth_refresh_revoke_user($1, 'security_event')", [userId]);
    applied();
    await commit;
  }));
  return { pid, mutate: () => { begin(); return Promise.race([mutated, done]); }, commit: () => { finish(); return done; },
    close: async () => { begin(); finish(); await done; } };
}

async function waitForBlocker(pid: number) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const { rows } = await pool.query('SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [pid]);
    if (rows.length) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Initial issuance did not wait for revocation.');
}
