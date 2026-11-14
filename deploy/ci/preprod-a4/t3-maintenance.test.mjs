import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aclStatements } from './t3-acl.mjs';
import { aclFormulaSha256, captureAcl, restoreSql } from './t3-restore.mjs';
import { assertRearmState } from './t3-rearm.mjs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, PROD_POSTGRES_IMAGE, PROD_POSTGRES_TOOL_IMAGE, PROD_POSTGRES_VERSION, RESTORE_NS } from './t3-fixture.mjs';
import { tierOf, assertRequest } from './guards.mjs';
import { approvedRequest } from './fixtures.mjs';
import { ops } from './ops.mjs';

test('ACL extraction keeps multiline column grants and ignores quoted function text', () => {
  const sql = `-- schema dump
CREATE FUNCTION f() RETURNS void AS $body$
GRANT ALL ON users TO PUBLIC;
$body$ LANGUAGE SQL;
ALTER TABLE public.users OWNER TO app;
GRANT SELECT (client_id,
  allowed_scopes) ON TABLE public.oauth_clients TO idp_identity_reader;
REVOKE ALL ON TABLE public.users FROM idp_identity_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE app GRANT SELECT ON TABLES TO reader;
`;
  const out = aclStatements(sql);
  assert.doesNotMatch(out, /TO PUBLIC/);
  assert.match(out, /GRANT SELECT \(client_id,\n  allowed_scopes\)/);
  assert.match(out, /ALTER DEFAULT PRIVILEGES/);
  assert.match(out, /REVOKE ALL/);
  assert.throws(() => aclStatements("CREATE FUNCTION f() AS $$unfinished"));
});

test('restore covers all application schemas, invalidates OAuth and aborts before commit on ACL mismatch', () => {
  const out = restoreSql('CREATE SCHEMA public;\n-- fixture dump', 'GRANT SELECT ON x TO reader;', 'a'.repeat(64));
  assert.match(out, /DROP SCHEMA %I CASCADE/);
  assert.equal(out.match(/CREATE SCHEMA public/g).length, 1);
  assert.match(out, /oauth_refresh_invalidate_restore/);
  assert.match(out, /DELETE FROM public.oauth_tokens/);
  assert.match(out, /SELECT 1 OPERATOR\(pg_catalog\.\/\) \(\(:'acl_sha256' OPERATOR\(pg_catalog\.=\)/);
  assert.ok(out.indexOf('GRANT SELECT') < out.indexOf('SELECT 1 OPERATOR(pg_catalog./)'));
  // The catalogue runs under the empty search_path left by the dump preamble: nothing in it may follow that path.
  assert.doesNotMatch(out, /pg_get_function_identity_arguments\(/);
  assert.match(out, /pg_catalog\.unnest\(p\.proargtypes/);
  assert.match(restoreSql('-- dump without the public schema', '', 'a'.repeat(64)),
    /CREATE SCHEMA public;\nCOMMENT ON SCHEMA public IS 'standard public schema';/);
  assert.throws(() => restoreSql('', '', "'injection"));
  const dir = mkdtempSync(join(tmpdir(), 't3-acl-'));
  try {
    const receipt = captureAcl({ config: {}, call: args => args.includes('pg_dump') ? 'GRANT USAGE ON SCHEMA public TO app;\n'
      : args.includes('psql') ? ('b'.repeat(64) + '\n') : '' }, dir);
    assert.equal(receipt.aclFormulaSha256, aclFormulaSha256());
    assert.equal(JSON.parse(readFileSync(join(dir, 'acl.json'), 'utf8')).aclFormulaSha256, aclFormulaSha256());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rearm refuses active, committed, unknown and reused attempts', () => {
  for (const state of [null, { step: 'W3' }, { step: 'DONE' }, { step: 'DONE', commitVerified: true }]) {
    assert.throws(() => assertRearmState(state, null, 'new'));
  }
  const state = { step: 'DONE', commitVerified: false, operationId: 'old' };
  assert.throws(() => assertRearmState(state, true, 'new'));
  assert.throws(() => assertRearmState(state, null, 'old'));
  assert.doesNotThrow(() => assertRearmState(state, null, 'new'));
});

// Live prod shape: prod labels only, no priority class, the database on the floating image tag.
const prodLabels = name => ({ 'app.kubernetes.io/name': 'sentropic', 'app.kubernetes.io/component': name });
const inventory = (dumpImage = PROD_POSTGRES_TOOL_IMAGE) => [...['api','auth-idp','ui','postgres'].map(name => ({
  apiVersion: 'apps/v1', kind: name === 'postgres' ? 'StatefulSet' : 'Deployment', metadata: { name, namespace: 'sentropic' },
  spec: { selector: { matchLabels: prodLabels(name) }, template: { metadata: { labels: prodLabels(name) }, spec: { containers: [
    { name, image: name === 'postgres' ? 'postgres:17-alpine' : `ghcr.io/rhanka/sentropic-${name === 'ui' ? 'ui' : 'api'}@sha256:${'a'.repeat(64)}`,
      imagePullPolicy: 'IfNotPresent' }] } } } })),
{ apiVersion: 'batch/v1', kind: 'CronJob', metadata: { name: 'pgbackup', namespace: 'sentropic' }, spec: { suspend: false, jobTemplate: { spec: {
  template: { metadata: { labels: prodLabels('pgbackup') }, spec: { initContainers: [{ name: 'dump', image: dumpImage }],
    containers: [{ name: 'upload', image: `peakcom/s5cmd:v2.2.2@sha256:${'b'.repeat(64)}` }] } } } } } }];
const template = (out, kind, name) => { const object = out.items.find(o => o.kind === kind && o.metadata.name === name);
  return kind === 'CronJob' ? object.spec.jobTemplate.spec.template : object.spec.template; };

// The platform policies of the isolated namespace select `component`; prod selects app.kubernetes.io/*.
test('fixture pods carry the labels the isolated namespace policies select, next to the prod labels', () => {
  const out = fixture(inventory());
  for (const [kind, name, component] of [['Deployment', 'ui', 'ui'], ['Deployment', 'auth-idp', 'auth-idp'], ['CronJob', 'pgbackup', 'backup-download']]) {
    assert.deepEqual(template(out, kind, name).metadata.labels, { ...prodLabels(name), component }, name);
  }
  for (const [kind, name] of [['Deployment', 'api'], ['StatefulSet', 'postgres']]) assert.deepEqual(template(out, kind, name).metadata.labels, prodLabels(name));
  for (const name of ['api', 'auth-idp', 'ui']) {
    assert.deepEqual(out.items.find(o => o.kind === 'Deployment' && o.metadata.name === name).spec.selector.matchLabels, prodLabels(name));
    assert.equal(template(out, 'Deployment', name).spec.priorityClassName, 'sentropic-t3-critical', name);
  }
  assert.equal(template(out, 'StatefulSet', 'postgres').spec.priorityClassName, undefined);
  assert.equal(template(out, 'CronJob', 'pgbackup').spec.priorityClassName, undefined);
});

// Prod runs 17.11 from a node cache behind a floating tag; a fixture node pulled 17.12 through the same tag.
test('fixture pins the database to the prod server bytes and refuses any other postgres image', () => {
  const server = template(fixture(inventory()), 'StatefulSet', 'postgres').spec.containers[0];
  assert.deepEqual([server.image, server.imagePullPolicy], [PROD_POSTGRES_IMAGE, 'IfNotPresent']);
  assert.equal(template(fixture(inventory()), 'CronJob', 'pgbackup').spec.initContainers[0].image, PROD_POSTGRES_TOOL_IMAGE);
  for (const image of ['postgres:17-alpine', 'postgres', 'postgres:17.12-alpine', 'docker.io/library/postgres:17-alpine',
    `postgres:17-alpine@sha256:${'d'.repeat(64)}`]) assert.throws(() => fixture(inventory(image)), /fixture_postgres_unpinned/, image);
  const unnamed = inventory(); unnamed[3].spec.template.spec.containers[0].name = 'database';
  assert.throws(() => fixture(unnamed), /fixture_postgres_container/);
  // One pin everywhere: the prod overlay, the backup job, the SQL gate and the fixture name the same bytes.
  const read = path => readFileSync(path, 'utf8');
  assert.ok(read('deploy/k8s/overlays/prod/kustomization.yaml').includes(`image: ${PROD_POSTGRES_IMAGE}\n`));
  assert.ok(read('deploy/k8s/base/70-pgbackup-cronjob.yaml').includes(`image: ${PROD_POSTGRES_TOOL_IMAGE}\n`));
  const targets = read('deploy/ci/preprod-a4/targets.mk');
  assert.ok(targets.includes(`T3_PG_VERSION := ${PROD_POSTGRES_VERSION}\n`) && targets.includes(`T3_PG_IMAGES := ${PROD_POSTGRES_IMAGE} ${PROD_POSTGRES_TOOL_IMAGE}\n`));
  const images = targets.match(/\bpostgres[:@][^\s"']+/g);
  assert.ok(images.length >= 2 && images.every(image => /@sha256:[a-f0-9]{64}$/.test(image)), 'no postgres image without a digest');
});

test('fixture drops external policies and secrets, isolates HTTP and keeps postgres name', () => {
  const objects = inventory();
  objects.push({ kind: 'NetworkPolicy', metadata: { name: 'allow-public' }, spec: { egress: [{}] } });
  objects.push({ kind: 'ServiceAccount',metadata: { name: 'sentropic-app' } });
  objects.push({ kind: 'ConfigMap',metadata: { name: 'api' },data: {
    WEBAUTHN_RP_ID: 'sent-tech.ca',WEBAUTHN_ORIGIN: 'https://sentropic.sent-tech.ca',SCW_TEM_API_BASE_URL: 'https://api.scaleway.com' } });
  objects.push({ kind: 'Ingress', metadata: { name: 'sentropic' }, spec: { host: 'sentropic.sent-tech.ca' } });
  const out = fixture(objects);
  assert.ok(out.items.every(o => o.metadata.namespace === RESTORE_NS));
  assert.ok(!out.items.some(o => o.metadata.name === 'allow-public'));
  assert.equal(out.items.find(o => o.kind === 'Ingress').spec.host,'app.restore-a4.test');
  assert.ok(out.items.some(o => o.kind === 'ServiceAccount' && o.metadata.name === 'sentropic-app'));
  const cm = out.items.find(o => o.kind === 'ConfigMap');
  assert.equal(cm.data.WEBAUTHN_ORIGIN,'https://sentropic.sent-tech.ca');
  assert.equal(cm.data.SCW_TEM_API_BASE_URL,'http://tem.sentropic-restore-sinks.svc.cluster.local:8080');
  assert.throws(() => fixture([...objects, { kind: 'Secret' }]));
  assert.throws(() => fixture([]));
});

test('restore wire retains logical prod request while directing every call and runtime to fixture', () => {
  const tier = tierOf({ A4_TIER: 'restore' });
  assert.equal(tier.namespace, 'sentropic'); assert.equal(tier.destinationNamespace, RESTORE_NS);
  const request = { ...approvedRequest, format: 'prod-a4-request/1', namespace: 'sentropic',
    emailCodeActiveKeyRef: 'email-code-hmac:v1:prod:15c2f8b66073655a' };
  assertRequest(request, tier);
  const calls = [];
  ops({ A4_TIER: 'restore', A4_OPERATION: 'wire', A4_DRY_RUN: '0', A4_REQUEST_FILE: '/request' },
    (_k,args,_in,namespace) => {
      assert.equal(namespace, RESTORE_NS); calls.push(args);
      return args[0] === 'get' ? '{"spec":{"replicas":0}}' : 'runtime';
    }, p => p === '/request' ? JSON.stringify(request) : 'synthetic');
  assert.ok(calls.some(a => a.join(' ') === 'kustomize deploy/k8s/overlays/restore-a4/runtime'));
});
