import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { runMigrations } from '../../src/db/run-migrations';
import { createArtifactReaderActivation } from '../../src/services/artifacts/reader-activation';
import { createArtifactHttpRouter } from '../../src/routes/namespaces/artifacts';

const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const database = `test_w3a_${randomUUID().replaceAll('-', '')}`;
let pool: Pool;
const ends: Promise<void>[] = [];
const artifactId = randomUUID();
const releaseId = randomUUID();
const scope = randomUUID();
const session = { subjectId: 'reader', sessionId: 'session', tenantId: 'tenant', workspaceId: 'workspace' };
const config = { baseDomain: 'content.example.test', profileDigest: 'b'.repeat(64) };
const target = { artifactId, releaseId, channel: 'stable' as const,
  targetOrigin: `https://${artifactId}.${config.baseDomain}`, nonce: 'a'.repeat(43) };
const reader = (extra = {}) => createArtifactReaderActivation({ pool, ...config, ...extra });
const input = (issued: Awaited<ReturnType<ReturnType<typeof reader>['issue']>>) => ({
  flowId: issued.flow.flowId, ticketId: issued.ticket.ticketId, nonce: target.nonce, targetOrigin: target.targetOrigin,
});

describe('resources reader activation port', () => {
  const controlOrigin = 'https://app.example.test';
  function route(enabled = true, authenticated = true) {
    const transport = vi.fn();
    const identity = vi.fn(async () => authenticated ? { workspaceId: session.workspaceId,
      identity: { subject: session.subjectId, tenantId: session.tenantId, clientId: 'session-client', credentialId: 'verified' } } : null);
    const issue = vi.fn(async (_bound, value: typeof target) => reader().issue(session, value));
    const app = createArtifactHttpRouter({ transport, identity,
      reader: { enabled: () => enabled, controlOrigin, issue } });
    const post = (body: unknown = target, origin = controlOrigin) => app.request('/reader-activation', {
      method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body),
    });
    return { post, transport, identity, issue };
  }

  it('should issue from verified session context through a distinct reader port', async () => {
    const { post, issue, transport } = route();
    const response = await post();
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'flowId', 'targetOrigin', 'ticketId']);
    expect(issue).toHaveBeenCalledWith({ workspaceId: session.workspaceId, identity: {
      subject: session.subjectId, tenantId: session.tenantId, clientId: 'session-client', credentialId: 'verified',
    } }, target);
    expect(transport).not.toHaveBeenCalled();
  });

  it('should load the default-closed product reader without origin or storage configuration', async () => {
    vi.stubEnv('APP_ARTIFACT_READER_ENABLED', '0');
    vi.stubEnv('UI_BASE_URL', undefined);
    vi.stubEnv('APP_ARTIFACT_CONTENT_BASE_DOMAIN', undefined);
    try {
      const product = await import('../../src/services/artifacts/instance');
      expect(product.productArtifactReaderPort.enabled()).toBe(false);
      expect(() => product.getProductArtifactReader()).toThrow(/disabled/);
    } finally { vi.unstubAllEnvs(); }
  });

  it('should stay closed by default and require an authenticated exact-origin request', async () => {
    expect((await route(false).post()).status).toBe(404);
    expect((await route(true, false).post()).status).toBe(401);
    for (const origin of ['', 'null', 'https://sibling.example.test', `${controlOrigin}.evil.test`]) {
      const { post, identity, issue } = route();
      expect((await post(target, origin)).status).toBe(403);
      expect(identity).not.toHaveBeenCalled();
      expect(issue).not.toHaveBeenCalled();
    }
    const closed = createArtifactHttpRouter({ transport: vi.fn(), identity: vi.fn() });
    expect((await closed.request('/reader-activation', { method: 'POST' })).status).toBe(404);
  });

  it.each(['subjectId', 'sessionId', 'tenantId', 'workspaceId', 'profileDigest', 'policyRevision'])
  ('should refuse caller-controlled authority field %s before issuance', async field => {
    const { post, issue } = route();
    const response = await post({ ...target, [field]: 'forged' });
    expect(response.status).toBe(400);
    expect(issue).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('forged');
  });
});

beforeAll(async () => {
  await admin.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${database}`;
  pool = new Pool({ connectionString: url.toString() });
  pool.on('connect', client => ends.push(new Promise<void>(resolve => client.once('end', resolve))));
  await runMigrations(pool);
});
afterAll(async () => {
  await pool?.end();
  await Promise.all(ends);
  await admin.query(`DROP DATABASE "${database}"`);
  await admin.end();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await pool.query(`TRUNCATE artifact_host.activation_namespaces, artifacts.storage_scopes,
    control.artifact_host_kv, users, tenants CASCADE;
    INSERT INTO users(id, role, account_status) VALUES ('reader','editor','active'), ('other','editor','active');
    INSERT INTO tenants(id, name) VALUES ('tenant','Tenant');
    INSERT INTO workspaces(id, name, tenant_id) VALUES ('workspace','Workspace','tenant');
    INSERT INTO tenant_memberships(tenant_id,user_id,status) VALUES ('tenant','reader','approved');
    INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ('workspace','reader','viewer');
    INSERT INTO user_sessions(id,user_id,session_token_hash,expires_at) VALUES
      ('session','reader','session-hash',clock_timestamp() + interval '1 hour'),
      ('new-session','reader','new-session-hash',clock_timestamp() + interval '1 hour');`);
  await pool.query(`INSERT INTO control.artifact_host_kv(storage_scope_id,key,value) VALUES ($1,$2,$3);
    `, ['app-artifact-scopes/v1', JSON.stringify(['tenant', 'workspace']), scope]);
  await pool.query(`INSERT INTO artifacts.storage_scopes(id,org_id) VALUES ($1,'tenant');
    `, [scope]);
  await pool.query(`INSERT INTO artifacts.artifacts(id,storage_scope_id,owner_id,binding_name)
    VALUES ($1,$2,'other','report')`, [artifactId, scope]);
  await pool.query(`INSERT INTO artifacts.artifact_access(artifact_id,principal_id,permission) VALUES ($1,'reader','read')`, [artifactId]);
  await pool.query(`INSERT INTO artifacts.releases(id,artifact_id,manifest_digest,manifest) VALUES ($1,$2,'digest','{}')`, [releaseId, artifactId]);
  await pool.query(`INSERT INTO artifacts.artifact_current(artifact_id,release_id) VALUES ($1,$2)`, [artifactId, releaseId]);
});

describe('trusted app reader activation', () => {
  it('should acknowledge only one consume across host instances and deny replay', async () => {
    const issued = await reader().issue(session, target);
    const results = await Promise.all([reader(), reader()].map(host => host.consume(session, input(issued))));
    expect(results.filter(Boolean)).toEqual([issued.ticket]);
    expect(await reader().consume(session, input(issued))).toBeUndefined();
  });

  it.each([
    ['browser', { nonce: 'z'.repeat(43) }, {}],
    ['subject', {}, { subjectId: 'other' }],
    ['session', {}, { sessionId: 'new-session' }],
    ['origin', { targetOrigin: 'https://foreign.example.test' }, {}],
    ['ticket', { ticketId: randomUUID() }, {}],
    ['flow', { flowId: randomUUID() }, {}],
    ['workspace', {}, { workspaceId: 'foreign' }],
    ['tenant', {}, { tenantId: 'foreign' }],
  ])('should refuse a wrong %s without consuming either record', async (_name, changed, claims) => {
    const issued = await reader().issue(session, target);
    expect(await reader().consume({ ...session, ...claims }, { ...input(issued), ...changed })).toBeUndefined();
    expect(await reader().consume(session, input(issued))).toEqual(issued.ticket);
  });

  it('should recover expired activation with the current session without an MFA port', async () => {
    const short = reader({ ticketTtlSeconds: 1, flowTtlSeconds: 1 });
    const expired = await short.issue(session, target);
    await pool.query('SELECT pg_sleep(1.05)');
    expect(await short.consume(session, input(expired))).toBeUndefined();
    const fresh = await reader().issue(session, target);
    expect(fresh.ticket.ticketId).not.toBe(expired.ticket.ticketId);
    expect(await reader().consume(session, input(fresh))).toEqual(fresh.ticket);
  });

  it.each([
    `DELETE FROM user_sessions WHERE id = 'session'`,
    `UPDATE user_sessions SET expires_at = clock_timestamp() WHERE id = 'session'`,
    `UPDATE users SET disabled_at = clock_timestamp() WHERE id = 'reader'`,
    `DELETE FROM workspace_memberships WHERE user_id = 'reader'`,
    `UPDATE tenant_memberships SET status = 'pending' WHERE user_id = 'reader'`,
    `DELETE FROM artifacts.artifact_access WHERE principal_id = 'reader'`,
    `UPDATE artifacts.artifacts SET lifecycle_state = 'withdrawn'`,
    `UPDATE artifacts.artifacts SET lifecycle_state = 'deleted'`,
    `UPDATE artifacts.releases SET state = 'purged'`,
  ])('should deny current authority revocation: %s', async sql => {
    const host = reader();
    const issued = await host.issue(session, target);
    await pool.query(sql);
    expect(await host.consume(session, input(issued))).toBeUndefined();
    await expect(host.issue(session, target)).rejects.toThrow();
    expect((await pool.query('SELECT count(*)::int AS n FROM artifact_host.activation_tickets')).rows[0].n).toBe(1);
  });

  it('should reject a changed compiled profile or policy revision without consuming', async () => {
    const issued = await reader().issue(session, target);
    expect(await reader({ profileDigest: 'c'.repeat(64) }).consume(session, input(issued))).toBeUndefined();
    await pool.query(`UPDATE workspace_memberships SET role = 'editor' WHERE user_id = 'reader'`);
    expect(await reader().consume(session, input(issued))).toBeUndefined();
    const fresh = await reader().issue(session, target);
    expect(await reader().consume(session, input(fresh))).toEqual(fresh.ticket);
  });

  it.each([
    { channel: 'pinned' }, { releaseId: randomUUID() }, { artifactId: randomUUID() },
    { targetOrigin: `http://${artifactId}.${config.baseDomain}` },
    { targetOrigin: `${target.targetOrigin}:444` }, { targetOrigin: `${target.targetOrigin}/path` },
    { targetOrigin: 'https://foreign.example.test' }, { nonce: '' },
  ])('should refuse an unbound target before issuing durable state: %j', async changed => {
    await expect(reader().issue(session, { ...target, ...changed } as typeof target)).rejects.toThrow();
    expect((await pool.query('SELECT count(*)::int AS n FROM artifact_host.activation_tickets')).rows[0].n).toBe(0);
  });

  it('should fence stable A after B becomes current while allowing pinned A', async () => {
    const stable = await reader().issue(session, target);
    const pinnedTarget = { ...target, channel: 'pinned' as const,
      targetOrigin: `https://${releaseId}.pinned.${config.baseDomain}` };
    const pinned = await reader().issue(session, pinnedTarget);
    const b = randomUUID();
    await pool.query(`INSERT INTO artifacts.releases(id,artifact_id,manifest_digest,manifest) VALUES ($1,$2,'b','{}')`, [b, artifactId]);
    await pool.query('UPDATE artifacts.artifact_current SET release_id=$1', [b]);
    await pool.query(`UPDATE artifacts.releases SET state='retired' WHERE id=$1`, [releaseId]);
    expect(await reader().consume(session, input(stable))).toBeUndefined();
    expect(await reader().consume(session, { ...input(pinned), targetOrigin: pinnedTarget.targetOrigin })).toEqual(pinned.ticket);
  });

  it.each(['acl', 'pointer', 'session-expiry'])('should recheck %s after a stable-pointer lock wait', async change => {
    const issued = await reader().issue(session, target);
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT artifact_id FROM artifacts.artifact_current WHERE artifact_id=$1 FOR UPDATE', [artifactId]);
    const pending = reader().consume(session, input(issued));
    try {
      await vi.waitFor(async () => {
        expect((await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND query LIKE '%artifact_current%' AND pid<>pg_backend_pid()`)).rowCount).toBeGreaterThan(0);
      });
      if (change === 'acl') await pool.query(`DELETE FROM artifacts.artifact_access WHERE principal_id='reader'`);
      if (change === 'session-expiry') await pool.query(`UPDATE user_sessions SET expires_at=clock_timestamp() WHERE id='session'`);
      if (change === 'pointer') {
        const b = randomUUID();
        await blocker.query(`INSERT INTO artifacts.releases(id,artifact_id,manifest_digest,manifest) VALUES ($1,$2,'b','{}')`, [b, artifactId]);
        await blocker.query('UPDATE artifacts.artifact_current SET release_id=$1', [b]);
      }
    } finally {
      await blocker.query('COMMIT');
      blocker.release();
    }
    expect(await pending).toBeUndefined();
    expect((await pool.query('SELECT count(*)::int AS n FROM artifact_host.activation_tickets')).rows[0].n).toBe(1);
  });

  it('should emit no grant on uncertain commit and recover with a fresh current-session flow', async () => {
    const issued = await reader().issue(session, target);
    const uncertain = { query: pool.query.bind(pool), async connect() {
      const client = await pool.connect();
      let consumed = false;
      return { async query(sql: string, values?: unknown[]) {
        const result = await client.query(sql, values);
        if (sql.includes('DELETE FROM artifact_host.activation_tickets t')) consumed = true;
        if (sql === 'COMMIT' && consumed) throw new Error('injected commit acknowledgement loss');
        return result;
      }, release(destroy?: boolean) { client.release(destroy); } };
    } } as unknown as Pool;
    const grant = vi.fn();
    await expect(reader({ pool: uncertain }).consume(session, input(issued)).then(grant)).rejects.toThrow(/commit outcome unknown/);
    expect(grant).not.toHaveBeenCalled();
    expect(await reader().consume(session, input(issued))).toBeUndefined();
    const fresh = await reader().issue(session, target);
    expect(await reader().consume(session, input(fresh))).toEqual(fresh.ticket);
  });

  it.each(['connect', 'consume'])('should emit no grant on %s failure and preserve unconsumed state', async failure => {
    const issued = await reader().issue(session, target);
    const failing = { query: pool.query.bind(pool), async connect() {
      if (failure === 'connect') throw new Error('injected PG outage');
      const client = await pool.connect();
      return { async query(sql: string, values?: unknown[]) {
        if (sql.includes('DELETE FROM artifact_host.activation_tickets t')) throw new Error('injected consume failure');
        return client.query(sql, values);
      }, release(destroy?: boolean) { client.release(destroy); } };
    } } as unknown as Pool;
    const grant = vi.fn();
    await expect(reader({ pool: failing }).consume(session, input(issued)).then(grant)).rejects.toThrow(/injected/);
    expect(grant).not.toHaveBeenCalled();
    expect(await reader().consume(session, input(issued))).toEqual(issued.ticket);
  });
});
