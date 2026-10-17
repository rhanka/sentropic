import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { applyPgMigrations, loadPgAssets } from '@sentropic/cluster-mesh/storage/postgres';
import { createCommentsModule, createCommentsPostgresStorage } from '@sentropic/cluster-mesh/comments';
import { conformanceCapacity, conformanceScope, conformanceTarget, conformanceResource, conformanceBody, conformanceProvenance } from './installed-oracle.mjs';
import { createAnnotationRevision } from '@sentropic/comments';

export const grantFor = (scope, overrides = {}) => ({
  token: randomBytes(16).toString('hex'), moduleId: 'comments', scope, principalId: 'user-1',
  operations: ['read', 'write', 'maintain'], issuer: 'installed-host', authorityRevision: '1', policyRevision: '1',
  moduleAuthority: null, lifetime: { kind: 'invocation', invocationId: 'installed-invocation' }, ...overrides,
});
export const installedHost = async () => {
  const pool = new pg.Pool({ connectionString: process.env.CM_PG_URL, max: 1, connectionTimeoutMillis: 2000 });
  let active = false; let statements = 0; let transactions = 0;
  const driver = { transaction: async (options, operation) => {
    assert.equal(active, false, 'one canonical operation must use one host session');
    active = true; let client; let expired = false; let timer;
    try {
      client = await pool.connect(); transactions++;
      timer = setTimeout(() => { expired = true; client.release(true); }, options.deadlineMs);
      await client.query(`BEGIN ISOLATION LEVEL SERIALIZABLE ${options.readOnly ? 'READ ONLY' : 'READ WRITE'}`);
      const result = await operation({ execute: ({ text, values }) => { statements++; return client.query(text, values); } });
      await client.query('COMMIT'); return result;
    } catch (error) {
      if (client && !expired) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { clearTimeout(timer); if (client && !expired) client.release(); active = false; }
  } };
  const name = `installed_${randomBytes(6).toString('hex')}`;
  const layout = { dataSchema: name, projectionSchemas: { comments: name }, outboxSchema: name };
  const history = {
    read: async (session) => (await session.execute({ text: `SELECT receipt FROM "${name}".host_history ORDER BY ordinal`, values: [] })).rows.map((row) => row.receipt),
    complete: (session, receipt) => session.execute({ text: `INSERT INTO "${name}".host_history VALUES($1,$2::jsonb)`, values: [receipt.order, JSON.stringify(receipt)] }),
  };
  const assets = await loadPgAssets({ comments: true });
  await driver.transaction({ readOnly: false, deadlineMs: 5000 }, async (session) => {
    await session.execute({ text: `CREATE SCHEMA "${name}"; CREATE TABLE "${name}".host_history(ordinal integer PRIMARY KEY, receipt jsonb NOT NULL)`, values: [] });
    await applyPgMigrations(session, layout, assets, history, { id: 'installed-host/001', checksum: 'a'.repeat(64) });
  });
  const capacity = conformanceCapacity(); const scope = conformanceScope(); const authority = { allowed: true };
  const services = { capacity, capabilities: { check: async () => authority.allowed }, resolver: { resolve: async () => 'exact' }, clock: { now: () => 1717000000123 } };
  const options = { driver, layout, history, services, cursorSecret: randomBytes(32).toString('hex') };
  const root = await createCommentsPostgresStorage(options); const grant = grantFor(scope); const bound = await root.bindNew(grant);
  const fence = { fenceId: 'installed-import', epoch: '1' }; await root.provisionFence(grant, fence);
  const module = createCommentsModule({ storage: root.adapter(), capacity });
  const annotation = (id, previous = null, text = 'installed content') => createAnnotationRevision(previous, {
    scope, annotationId: id, primary: conformanceTarget(conformanceResource(scope)), secondary: [], visualAnchors: [], body: conformanceBody(text), provenance: conformanceProvenance(),
  }, capacity);
  return { root, grant, bound, fence, module, capacity, scope, authority, annotation,
    metrics: () => ({ statements, transactions }),
    restart: async () => createCommentsModule({ storage: (await createCommentsPostgresStorage(options)).adapter(), capacity }),
    retainedBytes: async () => driver.transaction({ readOnly: true, deadlineMs: 2000 }, async (session) => (await session.execute({ text: `SELECT convert_from(bytes,'UTF8') AS bytes FROM "${name}".payloads WHERE bytes IS NOT NULL`, values: [] })).rows.map((row) => row.bytes)),
    close: async () => { await driver.transaction({ readOnly: false, deadlineMs: 5000 }, (session) => session.execute({ text: `DROP SCHEMA "${name}" CASCADE`, values: [] })); await pool.end(); },
  };
};
