import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { runMigrations } from '../../../api/src/db/run-migrations';
import { createArtifactReaderActivation } from '../../../api/src/services/artifacts/reader-activation';
import { createContentRuntime } from '../src/runtime';

const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const database = `test_w3b_${randomUUID().replaceAll('-', '')}`;
let pool: Pool;
const ends: Promise<void>[] = [];
const artifactId = randomUUID(), releaseId = randomUUID(), scope = randomUUID();
const config = { baseDomain: 'content.example.test', profileDigest: 'b'.repeat(64) };
const origin = `https://${artifactId}.${config.baseDomain}`;
const session = { subjectId: 'reader', sessionId: 'session', tenantId: 'tenant', workspaceId: 'workspace' };
const bytes = new TextEncoder().encode('<h1>Private runtime</h1>');
let key = 'a'.repeat(64);
const runtime = () => createContentRuntime({ pool, ...config, enabled: () => true,
  signingSecret: () => key, blobs: { getBlob: async () => bytes } });

beforeAll(async () => {
  await admin.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.DATABASE_URL!); url.pathname = `/${database}`;
  pool = new Pool({ connectionString: url.toString() });
  pool.on('connect', client => ends.push(new Promise<void>(resolve => client.once('end', resolve))));
  await runMigrations(pool);
  await pool.query(`INSERT INTO users(id,role,account_status) VALUES ('reader','editor','active'),('owner','editor','active');
    INSERT INTO tenants(id,name) VALUES ('tenant','Tenant');
    INSERT INTO workspaces(id,name,tenant_id) VALUES ('workspace','Workspace','tenant');
    INSERT INTO tenant_memberships(tenant_id,user_id,status) VALUES ('tenant','reader','approved');
    INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ('workspace','reader','viewer');
    INSERT INTO user_sessions(id,user_id,session_token_hash,expires_at)
      VALUES ('session','reader','session-hash',clock_timestamp()+interval '1 hour')`);
  await pool.query(`INSERT INTO control.artifact_host_kv(storage_scope_id,key,value) VALUES ($1,$2,$3)`,
    ['app-artifact-scopes/v1', JSON.stringify(['tenant','workspace']), scope]);
  await pool.query(`INSERT INTO artifacts.storage_scopes(id,org_id) VALUES ($1,'tenant')`, [scope]);
  await pool.query(`INSERT INTO artifacts.artifacts(id,storage_scope_id,owner_id,binding_name) VALUES ($1,$2,'owner','report')`, [artifactId,scope]);
  await pool.query(`INSERT INTO artifacts.artifact_access(artifact_id,principal_id,permission) VALUES ($1,'reader','read')`, [artifactId]);
  const manifest = JSON.stringify({ artifactId, files: [{ path:'index.html',digest:'a'.repeat(64),size:bytes.length,mimeType:'text/html' }] });
  await pool.query(`INSERT INTO artifacts.releases(id,artifact_id,manifest_digest,manifest) VALUES ($1,$2,'digest',$3)`, [releaseId,artifactId,manifest]);
  await pool.query(`INSERT INTO artifacts.artifact_current(artifact_id,release_id) VALUES ($1,$2)`, [artifactId,releaseId]);
});
afterAll(async () => {
  await pool?.end(); await Promise.all(ends);
  await admin.query(`DROP DATABASE "${database}"`); await admin.end();
});

describe('durable app content composition', () => {
  it('should consume W3.a once across content hosts and recheck live membership, ACL and keys', async () => {
    const host = runtime();
    const started = await host.fetch(new Request(`${origin}/_reader/nonce`));
    const { nonce } = await started.json();
    const issued = await createArtifactReaderActivation({ pool, ...config }).issue(session,
      { artifactId,releaseId,channel:'stable',targetOrigin:origin,nonce });
    const activate = (instance = host) => instance.fetch(new Request(`${origin}/_reader/activate`, { method:'POST',
      headers: { origin, 'content-type':'application/json','x-artifact-activation':'1',cookie:started.headers.get('set-cookie')! },
      body:JSON.stringify({flowId:issued.flow.flowId,ticketId:issued.ticket.ticketId}) }));
    const results = await Promise.all([activate(), activate(runtime())]);
    expect(results.map(response => response.status).sort()).toEqual([204,403]);
    const cookie = results.find(response => response.status === 204)!.headers.get('set-cookie')!;
    const read = () => runtime().fetch(new Request(origin, {headers:{cookie}}));
    expect(await (await read()).text()).toBe('<h1>Private runtime</h1>');
    await pool.query(`DELETE FROM workspace_memberships WHERE user_id='reader'`);
    expect((await read()).status).toBe(404);
    await pool.query(`INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ('workspace','reader','viewer')`);
    await pool.query(`DELETE FROM artifacts.artifact_access WHERE principal_id='reader'`);
    expect((await read()).status).toBe(404);
    await pool.query(`INSERT INTO artifacts.artifact_access(artifact_id,principal_id,permission) VALUES ($1,'reader','read')`, [artifactId]);
    key = 'b'.repeat(64);
    expect((await read()).status).toBe(401);
  });
});
