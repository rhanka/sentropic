import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import {
  applyPgMigrations, loadPgAssets, verifyPgInstallation, reattestPgInstallation,
  createPostgresKernel, PgSchemaDriftError,
} from '@sentropic/cluster-mesh/storage/postgres';

const host = (url, name) => {
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 2000 });
  const driver = { transaction: async (options, operation) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query("SET LOCAL statement_timeout='5s'");
      const result = await operation({ execute: ({ text, values }) => client.query(text, values) });
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  } };
  const tx = (operation) => driver.transaction({}, operation);
  const history = {
    read: async (session) => (await session.execute({
      text: `SELECT receipt FROM "${name}".host_history ORDER BY ordinal`, values: [],
    })).rows.map((row) => row.receipt),
    complete: (session, receipt) => session.execute({
      text: `INSERT INTO "${name}".host_history VALUES($1,$2::jsonb)`,
      values: [receipt.order, JSON.stringify(receipt)],
    }),
    reattest: async (session, approval) => {
      const result = await session.execute({
        text: `UPDATE "${name}".host_history SET receipt=jsonb_set(receipt,'{schemaFingerprint}',
          to_jsonb($1::text)) WHERE ordinal=(SELECT MAX(ordinal) FROM "${name}".host_history)
          AND receipt->>'schemaFingerprint'=$2`,
        values: [approval.schemaFingerprint, approval.previousFingerprint],
      });
      assert.equal(result.rowCount, 1, 'host fingerprint compare-and-swap');
      await session.execute({ text: `INSERT INTO "${name}".operator_audit VALUES($1::jsonb)`,
        values: [JSON.stringify(approval)] });
    },
  };
  const layout = { dataSchema: name, projectionSchemas: { comments: name }, outboxSchema: name };
  const options = { moduleId: 'comments', driver, layout, history, cursorSecret: 'major-upgrade-test-key' };
  const initialize = () => tx(async (session) => {
    await session.execute({ text: `CREATE SCHEMA "${name}";
      CREATE TABLE "${name}".host_history(ordinal integer PRIMARY KEY,receipt jsonb NOT NULL);
      CREATE TABLE "${name}".operator_audit(approval jsonb NOT NULL)`, values: [] });
    await applyPgMigrations(session, layout, await loadPgAssets(), history,
      { id: 'host/pg-major-test', checksum: 'a'.repeat(64) });
  });
  return { tx, options, history, initialize, close: () => pool.end(),
    version: async () => (await pool.query('SHOW server_version')).rows[0].server_version,
    fingerprint: async () => (await tx(history.read)).at(-1).schemaFingerprint,
    drop: () => pool.query(`DROP SCHEMA "${name}" CASCADE`),
  };
};

const witnessPath = '/reports/major-witness.json';
if (process.env.CM_MAJOR_PHASE === 'seed') {
  const name = `major_${randomBytes(6).toString('hex')}`;
  const source = host(process.env.CM_PG_URL, name);
  try {
    await source.initialize();
    const root = await createPostgresKernel(source.options);
    const grant = { token: 'major-grant', moduleId: 'comments', scope: { tenantId: 't', workspaceId: 'w' },
      principalId: 'user', operations: ['read', 'write'], issuer: 'host', authorityRevision: '1',
      policyRevision: '1', moduleAuthority: null, lifetime: { kind: 'invocation', invocationId: 'major' } };
    const bound = await root.bindNew(grant);
    await bound.appendChain('retained', { id: 'a', hash: 'a', bytes: 'before upgrade' },
      { kind: 'absent', allocation: '0' });
    await bound.appendChain('retained', { id: 'b', hash: 'b', bytes: 'second record' },
      { kind: 'head', hash: 'a' });
    const page = await bound.readPage('retained', 1, null, 4096);
    assert.ok(page.nextCursor);
    await writeFile(witnessPath, JSON.stringify({ name, grant, cursor: page.nextCursor,
      sourceVersion: await source.version(), previousFingerprint: await source.fingerprint() }));
  } finally { await source.close(); }
} else {
  const saved = JSON.parse(await readFile(witnessPath, 'utf8'));
  assert.match(saved.name, /^major_[a-f0-9]{12}$/);
  const target = host(process.env.CM_PG_UPGRADE_URL, saved.name);
  const reference = host(process.env.CM_PG_REFERENCE_URL, saved.name);
  const source = host(process.env.CM_PG_URL, saved.name);
  try {
    await reference.initialize();
    const assets = await loadPgAssets();
    const referenceFingerprint = await reference.fingerprint();
    let verification = 'already-matches';
    try { await target.tx((session) => verifyPgInstallation(session, target.options.layout, assets, target.history)); }
    catch (error) {
      assert.ok(error instanceof PgSchemaDriftError); verification = error.condition;
      assert.equal(error.expectedFingerprint, saved.previousFingerprint);
      assert.equal(error.actualFingerprint, referenceFingerprint);
    }
    await target.tx((session) => reattestPgInstallation(session, target.options.layout, assets, target.history, {
      previousFingerprint: saved.previousFingerprint, referenceFingerprint,
      hostMigrationId: 'host/postgresql-17-to-18', hostChecksum: 'b'.repeat(64),
      reason: 'Compared restored database with clean same-layout target-major package installation',
    }));
    const resumed = await (await createPostgresKernel(target.options)).bind(saved.grant);
    const page = await resumed.readPage('retained', 1, saved.cursor, 4096);
    assert.deepEqual(page.records.map((record) => record.hash), ['b']);
    const audit = await target.tx((s) => s.execute({
      text: `SELECT approval FROM "${saved.name}".operator_audit`, values: [],
    }));
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].approval.schemaFingerprint, referenceFingerprint);
    const result = { sourceVersion: saved.sourceVersion, targetVersion: await target.version(),
      verification, previousFingerprint: saved.previousFingerprint, referenceFingerprint,
      reattestation: 'pass', persistedCursor: 'pass', operatorAudit: 'pass' };
    await writeFile('/reports/major-upgrade.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    await Promise.allSettled([target.drop(), reference.drop(), source.drop()]);
    await Promise.all([target.close(), reference.close(), source.close()]);
  }
}
