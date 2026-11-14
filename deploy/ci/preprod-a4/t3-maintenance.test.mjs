import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aclStatements } from './t3-acl.mjs';
import { restoreSql } from './t3-restore.mjs';
import { assertRearmState } from './t3-rearm.mjs';
import { fixture, RESTORE_NS } from './t3-fixture.mjs';
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
  assert.match(out, /SELECT 1 \/ \(\(:'acl_sha256'/);
  assert.ok(out.indexOf('GRANT SELECT') < out.indexOf('SELECT 1 /'));
  assert.throws(() => restoreSql('', '', "'injection"));
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

test('fixture drops external policies and secrets, isolates HTTP and keeps postgres name', () => {
  const objects = ['api','auth-idp','ui','postgres'].map(name => ({
    apiVersion: 'apps/v1', kind: name === 'postgres' ? 'StatefulSet' : 'Deployment',
    metadata: { name, namespace: 'sentropic' }, spec: { template: { spec: { containers: [] } } },
  }));
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
