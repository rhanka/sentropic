import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../src/app';
import { db, pool } from '../../../src/db/client';
import { getSentropicOAuthPorts } from '../../../src/routes/auth/oauth';
import { oauthClients, oauthConsents } from '../../../src/db/schema';
import { updateCmUser } from '../../../src/services/identity/cm-users';
import { listCmSessionsForUser } from '../../../src/services/identity/cm-sessions';
import { createJwksAdapter } from '../../../src/services/auth/jwks-adapter';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';

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
    const ports = getSentropicOAuthPorts();
    const original = ports.oauthRefresh!.transaction;
    try {
      ports.oauthRefresh!.transaction = (lock, work) => original(lock, (bound) => work({ ...bound,
        jwks: { ...bound.jwks, getActiveKey: async () => { throw new Error('Injected signing failure'); } },
      }));
      const failed = await exchangeCode(code);
      expect(failed.status).toBe(503);
      expect(await failed.json()).toMatchObject({ error: 'temporarily_unavailable' });
      const { rows } = await pool.query('SELECT count(*)::int AS count FROM oauth_refresh_tokens WHERE user_id=$1', [userId]);
      expect(rows[0].count).toBe(0);
    } finally { ports.oauthRefresh!.transaction = original; }
    expect((await exchangeCode(code)).status).toBe(200);
  });

  it.each(['account', 'consent', 'security'])('should invalidate %s authority without restoration revival', async (kind) => {
    const initial = await issue();
    if (kind === 'account') {
      await updateCmUser(userId, { accountStatus: 'disabled_by_admin' });
      await updateCmUser(userId, { accountStatus: 'active' });
    } else if (kind === 'consent') await db.delete(oauthConsents).where(eq(oauthConsents.userId, userId));
    else {
      const { deleteAndQueueRemoteSessions } = await import('../../../src/services/auth/remote-revocation-outbox');
      await deleteAndQueueRemoteSessions({ userId });
    }
    expect((await post('token', { grant_type: 'refresh_token', refresh_token: initial.refresh_token })).status).toBe(400);
  });

  it('should preserve consented offline authority after a local browser logout', async () => {
    const initial = await issue();
    const [{ id: sessionId }] = await listCmSessionsForUser(userId);
    const { deleteAndQueueRemoteSessions } = await import('../../../src/services/auth/remote-revocation-outbox');
    await deleteAndQueueRemoteSessions({ sessionId });
    expect((await post('token', { grant_type: 'refresh_token', refresh_token: initial.refresh_token })).status).toBe(200);
  });

  it.each(['consent', 'security'].flatMap((kind) => ['mint-first', 'revoke-first'].map((order) => ({ kind, order }))))
  ('should serialize initial family creation with $kind: $order', async ({ kind, order }) => {
    const code = await obtainCode();
    const writer = await pool.connect();
    const ports = getSentropicOAuthPorts();
    const original = ports.oauthRefresh!.transaction;
    let release = () => {};
    try {
      await writer.query('BEGIN');
      const { rows: [{ pid: writerPid }] } = await writer.query('SELECT pg_backend_pid() AS pid');
      const mutation = kind === 'consent' ? 'DELETE FROM oauth_consents WHERE user_id=$1'
        : "SELECT oauth_refresh_revoke_user($1, 'security_event')";
      if (order === 'revoke-first') {
        await writer.query(mutation, [userId]);
        const pending = exchangeCode(code);
        await waitForBlocker(writerPid);
        await writer.query('COMMIT');
        expect((await pending).status).toBe(400);
      } else {
        let entered!: () => void;
        const locked = new Promise<void>((resolve) => { entered = resolve; });
        const barrier = new Promise<void>((resolve) => { release = resolve; });
        ports.oauthRefresh!.transaction = (lock, work) => original(lock, async (bound) => {
          entered(); await barrier; return work(bound);
        });
        const pending = exchangeCode(code);
        await locked;
        const revocation = writer.query(mutation, [userId]);
        // The owning transaction's user lock is visible as the writer's blocker.
        for (let attempt = 0; attempt < 500; attempt++) {
          const { rows } = await pool.query('SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND cardinality(pg_blocking_pids(pid)) > 0', [writerPid]);
          if (rows.length) break;
          if (attempt === 499) throw new Error('Initial issuance lock barrier not reached.');
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        release(); expect((await pending).status).toBe(200);
        await revocation; await writer.query('COMMIT');
      }
      const { rows } = await pool.query('SELECT count(*)::int AS count FROM oauth_refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
      expect(rows[0].count).toBe(0);
    } finally {
      release(); ports.oauthRefresh!.transaction = original;
      await writer.query('ROLLBACK'); writer.release();
    }
  });
});

async function waitForBlocker(pid: number) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const { rows } = await pool.query('SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [pid]);
    if (rows.length) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Initial issuance did not wait for revocation.');
}
