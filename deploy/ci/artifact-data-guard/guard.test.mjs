import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { commandFindings, manifestFindings, sqlFindings } from './guard.mjs';

const rules = findings => findings.map(finding => finding.rule);

test('should refuse every destructive SQL statement on artifact tables or their schemas', () => {
  for (const sql of ['DROP TABLE artifacts.releases;', 'drop table if exists public.x, "artifacts"."uploads" cascade;',
    'DROP SCHEMA IF EXISTS artifacts CASCADE;', 'DROP SCHEMA control;', 'TRUNCATE artifacts.artifacts;',
    'truncate table only public.a, artifacts.b;', 'DROP TABLE "control"."artifact_host_kv";',
    'ALTER TABLE artifacts.artifacts DROP COLUMN title;', 'DELETE FROM artifacts.live_drafts;',
    "DO $$ BEGIN EXECUTE 'TRUNCATE artifacts.uploads'; END $$;", 'TRUNCATE control.artifact_host_kv;']) {
    assert.equal(sqlFindings('api/drizzle/control/9999_x.sql', sql).length, 1, sql);
  }
});

test('should accept non-destructive artifact SQL and destructive SQL on other tables', () => {
  for (const sql of ['DROP TRIGGER IF EXISTS g ON artifacts.artifacts;', 'CREATE TRIGGER t BEFORE UPDATE OR DELETE OR TRUNCATE ON artifacts.e FOR EACH ROW EXECUTE FUNCTION f();',
    'ALTER TABLE artifacts.artifacts DROP CONSTRAINT c;', 'ALTER TABLE artifacts.a ALTER COLUMN b DROP DEFAULT;',
    'ALTER TABLE artifacts.a ALTER COLUMN b DROP NOT NULL;', 'DELETE FROM artifacts.upload_pages WHERE expires_at < now();',
    'DROP TABLE IF EXISTS public.users;', 'TRUNCATE public.oauth_tokens;', '-- DROP SCHEMA artifacts;\nSELECT 1;',
    '/* TRUNCATE artifacts.a; */ SELECT 1;']) {
    assert.deepEqual(sqlFindings('api/drizzle/control/9999_x.sql', sql), [], sql);
  }
});

test('should treat every table of the artifacts package as artifact data, qualified or not', () => {
  assert.deepEqual(rules(sqlFindings('packages/artifacts/sql/sqlite/0003_x.sql', 'DROP TABLE releases;')), ['drop-table']);
  assert.deepEqual(rules(sqlFindings('packages/artifacts/migrations/0014_x.sql', 'DELETE FROM uploads;')), ['delete-all']);
  assert.deepEqual(sqlFindings('packages/artifacts/migrations/0014_x.sql', 'DROP TRIGGER t ON uploads;'), []);
});

test('should refuse jobs and targets that delete the artifact object store, its volume or a bucket', () => {
  for (const line of ['kubectl delete pvc data-artifact-object-store-0', 'kubectl -n x delete statefulset/artifact-object-store',
    'kubectl delete pvc --all -n sentropic-preprod', 'kubectl delete namespace sentropic-preprod',
    's5cmd rb s3://anything', 'aws s3 rb s3://bucket --force', 'mc rb local/artifacts', 's5cmd rm "s3://$APP_ARTIFACT_S3_BUCKET/*"',
    'await s3.send(new DeleteBucketCommand({ Bucket }))']) {
    assert.equal(commandFindings('Makefile', line).length, 1, line);
  }
  for (const line of ['kubectl delete pod sentropic-a4-custodian', 'kubectl delete job pgbackup-manual-1', 's5cmd cp a s3://b/c',
    'kubectl delete -k deploy/k8s/overlays/prod --ignore-not-found']) {
    assert.deepEqual(commandFindings('Makefile', line), [], line);
  }
});

const statefulSet = (name, over = {}) => ({ kind: 'StatefulSet', metadata: { name }, spec: {
  volumeClaimTemplates: [{ metadata: { name: 'data' } }],
  template: { spec: { containers: [{ name: 'c', volumeMounts: [{ name: 'data', mountPath: '/data' }] }] } }, ...over } });
const preprod = () => [statefulSet('postgres'), statefulSet('artifact-object-store')];

test('should require the artifact object store and the database on their retained volumes', () => {
  assert.deepEqual(manifestFindings('preprod', preprod()), []);
  assert.deepEqual(manifestFindings('prod', [statefulSet('postgres')]), []);
  assert.deepEqual(rules(manifestFindings('preprod', [statefulSet('postgres')])), ['object-store-missing']);
  assert.deepEqual(rules(manifestFindings('prod', [])), ['database-missing']);
  const emptyDir = preprod();
  emptyDir[1].spec.template.spec.volumes = [{ name: 'data', emptyDir: {} }];
  assert.deepEqual(rules(manifestFindings('preprod-a4', emptyDir)), ['object-store-volume']);
  const deleting = preprod();
  deleting[0].spec.persistentVolumeClaimRetentionPolicy = { whenDeleted: 'Delete', whenScaled: 'Retain' };
  assert.deepEqual(rules(manifestFindings('preprod', deleting)), ['volume-retention']);
});

test('should refuse a rendered job whose command destroys artifact data', () => {
  const job = { kind: 'CronJob', metadata: { name: 'cleanup' }, spec: { jobTemplate: { spec: { template: { spec: {
    containers: [{ name: 'psql', command: ['psql', '-c', 'TRUNCATE artifacts.uploads'] }] } } } } } };
  assert.deepEqual(rules(manifestFindings('prod', [statefulSet('postgres'), job])), ['job-truncate']);
});

test('should keep the prod-to-preprod database restore refusing to overwrite preprod artifact data', () => {
  const make = readFileSync('Makefile', 'utf8');
  const recipe = make.slice(make.indexOf('\nk8s-db-restore-preprod:'), make.indexOf('\nk8s-undeploy:'));
  const refusal = recipe.indexOf('deploy/ci/artifact-data-guard/refuse-artifact-data.sql');
  assert.ok(refusal > 0 && refusal < recipe.indexOf('pg_restore'), 'artifact refusal precedes pg_restore');
  const sql = readFileSync('deploy/ci/artifact-data-guard/refuse-artifact-data.sql', 'utf8');
  assert.match(sql, /schemaname = 'artifacts'/);
  assert.match(sql, /RAISE EXCEPTION/);
  assert.deepEqual(sqlFindings('deploy/ci/artifact-data-guard/refuse-artifact-data.sql', sql), []);
});
