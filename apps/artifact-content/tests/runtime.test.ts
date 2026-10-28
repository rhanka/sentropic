import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { S3Client } from '@aws-sdk/client-s3';
import { runMigrations } from '../../../api/src/db/run-migrations';
import { createArtifactReaderActivation } from '../../../api/src/services/artifacts/reader-activation';
import { createContentRuntime } from '../src/runtime';
import { startContentServer } from '../src/index';

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
    for (const [deny, restore] of [
      [`UPDATE users SET disabled_at=clock_timestamp() WHERE id='reader'`, `UPDATE users SET disabled_at=NULL WHERE id='reader'`],
      [`UPDATE tenant_memberships SET status='pending' WHERE user_id='reader'`, `UPDATE tenant_memberships SET status='approved' WHERE user_id='reader'`],
      [`UPDATE artifacts.artifacts SET lifecycle_state='withdrawn' WHERE id='${artifactId}'`, `UPDATE artifacts.artifacts SET lifecycle_state='active' WHERE id='${artifactId}'`],
      [`UPDATE artifacts.releases SET state='purged' WHERE id='${releaseId}'`, `UPDATE artifacts.releases SET state='ready' WHERE id='${releaseId}'`],
    ]) {
      await pool.query(deny);
      expect((await read()).status).toBe(404);
      await pool.query(restore);
    }
    key = 'b'.repeat(64);
    expect((await read()).status).toBe(401);
  });

  it('should serve the enabled real listener with private S3 reads and a rotating mounted key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'w3b-key-'));
    const keyFile = join(dir, 'key'); writeFileSync(keyFile, key);
    const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === 'GetPublicAccessBlockCommand') return { PublicAccessBlockConfiguration: {
        BlockPublicAcls:true, IgnorePublicAcls:true, BlockPublicPolicy:true, RestrictPublicBuckets:true } };
      if (command.constructor.name === 'GetObjectCommand') return { Body: { transformToByteArray: async () => bytes } };
      throw new Error('Content process attempted a non-read object operation');
    }) as never);
    const url = new URL(process.env.DATABASE_URL!); url.pathname = `/${database}`;
    const server = await startContentServer({ hostname:'127.0.0.1',port:0,env: {
      APP_ARTIFACT_CONTENT_ENABLED:'1', APP_ARTIFACT_READER_ENABLED:'1', DATABASE_URL:url.toString(),
      APP_ARTIFACT_CONTENT_BASE_DOMAIN:config.baseDomain,APP_ARTIFACT_CONTENT_SIGNING_KEY_FILE:keyFile,
      APP_ARTIFACT_S3_BUCKET:'private',APP_ARTIFACT_S3_REGION:'test',
      APP_ARTIFACT_S3_ACCESS_KEY_ID:'test',APP_ARTIFACT_S3_SECRET_ACCESS_KEY:'test',
    } });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('TCP listener required');
      const local = `http://127.0.0.1:${address.port}`;
      const headers = { host:new URL(origin).host };
      const started = await fetch(`${local}/_reader/nonce`, {headers});
      const { nonce } = await started.json();
      const issued = await createArtifactReaderActivation({ pool,...config }).issue(session,
        {artifactId,releaseId,channel:'stable',targetOrigin:origin,nonce});
      const activated = await fetch(`${local}/_reader/activate`, {method:'POST',headers: {
        ...headers,origin,'content-type':'application/json','x-artifact-activation':'1',cookie:started.headers.get('set-cookie')! },
      body:JSON.stringify({flowId:issued.flow.flowId,ticketId:issued.ticket.ticketId})});
      expect(activated.status).toBe(204);
      const readHeaders = {...headers,cookie:activated.headers.get('set-cookie')!};
      expect(await (await fetch(local,{headers:readHeaders})).text()).toBe('<h1>Private runtime</h1>');
      writeFileSync(keyFile,'c'.repeat(64));
      expect((await fetch(local,{headers:readHeaders})).status).toBe(401);
      expect(send).toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
      send.mockRestore(); rmSync(dir,{recursive:true,force:true});
    }
  });
});
