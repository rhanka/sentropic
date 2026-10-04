import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { render, validateRun, classifyJobStatus, exportSnapshot, configure, waitJob } from './run-core.mjs';
import { antiRceGate, replaceSecrets, policyName } from './bundle-cd.mjs';
import { auditSummary, collectAudit } from './run.mjs';
const { parse } = createRequire('/tmp/idp-tools/package.json')('yaml');
export async function runTests(load, bundles) {
  let passed = 0;
  const check = async (name, fn) => { await fn(); passed++; console.log(`PASS: ${name}`); };
  const path = name => new URL(name, import.meta.url);
  const now = new Date('2026-10-03T12:00:00Z');
  const env = { GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', DRY_RUN: '1' };
  await check('manual dry-run and dated real-run validation', () => {
    assert.equal(validateRun(env, now).DRY_RUN, '1');
    assert.throws(() => validateRun({ ...env, DRY_RUN: '0' }, now));
    assert.equal(validateRun({ ...env, DRY_RUN: '0', CONFIRM: 'idp-sync-2026-10-03' }, now).DRY_RUN, '0');
    for (const patch of [{ GITHUB_REF: 'refs/heads/evil' }, { DRY_RUN: 'true' }, { ALLOWED_REKEY: 'invalid' }, { MAX_SNAPSHOT_AGE_S: '0' }, { CONFIRM: 'idp-sync-2026-10-02', DRY_RUN: '0' }]) assert.throws(() => validateRun({ ...env, ...patch }, now));
  });
  await check('scheduled import forces real run with empty rekey allowlist', () => {
    assert.deepEqual(validateRun({ ...env, GITHUB_EVENT_NAME: 'schedule', ALLOWED_REKEY: 'invalid' }, now), { DRY_RUN: '0', ALLOWED_REKEY: '', MAX_SNAPSHOT_AGE_S: '7200' });
  });
  await check('rendered Job matches dormant CronJob pod with safe substitutions', () => {
    const values = { JOB_NAME: 'test-sync', ...validateRun(env, now) };
    const raw = readFileSync(path('import-job.tmpl.yaml'), 'utf8');
    assert.throws(() => render(raw, {})); assert.throws(() => render('${unknown}', {}));
    const job = loadText(render(raw, values));
    const expected = structuredClone(bundles.preprod.find(o => o.kind === 'CronJob').spec.jobTemplate.spec);
    const entry = expected.template.spec.initContainers[0].env.find(e => e.name === 'JOB_NAME');
    delete entry.valueFrom; entry.value = values.JOB_NAME;
    assert.deepEqual(job.spec, expected);
    const hostile = '"\nother: injected\\value';
    assert.equal(loadText(render(raw, { ...values, ALLOWED_REKEY: hostile })).spec.template.spec.containers[0].env.find(e => e.name === 'ALLOWED_REKEY').value, hostile);
  });
  function loadText(raw) { return parse(raw); }
  await check('Job status distinguishes pending, active, complete and failed', async () => {
    for (const [status, expected] of [[{}, 'pending'], [{ active: 1 }, 'active'], [{ succeeded: 1 }, 'complete'], [{ conditions: [{ type: 'Complete', status: 'True' }] }, 'complete'], [{ failed: 1, succeeded: 1 }, 'failed'], [{ conditions: [{ type: 'Failed', status: 'True' }] }, 'failed']]) assert.equal(classifyJobStatus(status), expected);
    let calls = 0;
    assert.equal(await waitJob('test', 'job', 1, () => ({ stdout: JSON.stringify({ status: ++calls === 1 ? { active: 1 } : { succeeded: 1 } }) }), async () => {}), 'complete');
  });
  for (const verdict of ['complete', 'failed', 'invalid']) await check(`export ${verdict} always re-suspends and uses pod status only`, async () => {
    const patches = []; let lists = 0;
    const old = { metadata: { uid: 'old', name: 'old', ownerReferences: [{ uid: 'cron' }] }, status: { succeeded: 1 } };
    const fresh = { metadata: { uid: 'fresh', name: 'fresh', ownerReferences: [{ uid: 'cron' }] } };
    const k = args => {
      assert.ok(!args.includes('logs'));
      if (args.includes('patch')) { patches.push(JSON.parse(args.at(-1)).spec.suspend); return {}; }
      const resource = args[args.indexOf('get') + 1];
      const data = resource === 'cronjob' ? { metadata: { uid: 'cron' }, spec: { suspend: true } }
        : resource === 'jobs' ? { items: ++lists === 1 ? [old] : [old, fresh] }
        : resource === 'job' ? { status: verdict === 'failed' ? { failed: 1 } : { succeeded: 1 } }
        : { items: [{ status: { initContainerStatuses: [{ name: 'export', state: { terminated: { message: JSON.stringify({ users: verdict === 'invalid' ? 0 : 8, webauthn: 18 }) } } }] } }] };
      if (resource === 'job') assert.equal(args[4], 'fresh');
      return { stdout: JSON.stringify(data) };
    };
    if (verdict === 'complete') assert.equal(await exportSnapshot(k, async () => {}), 'fresh');
    else await assert.rejects(exportSnapshot(k, async () => {}));
    assert.deepEqual(patches, [false, true]);
  });
  for (const mode of ['policy-denial', 'rbac-denial', 'admitted', 'suspend-denied']) await check(`anti-RCE ${mode} verifies admission and fails closed`, () => {
    let calls = 0, neutralized = false;
    const k = args => {
      if (args.includes('role')) { neutralized = true; assert.equal(args.at(-1), '{"rules":[]}'); return {}; }
      calls++; assert.ok(args.includes('--dry-run=server')); assert.ok(args[0].startsWith('--as='));
      return calls === 1 ? { status: mode === 'admitted' ? 0 : 1, stderr: mode === 'rbac-denial' ? 'RBAC forbidden' : `${policyName}: jobTemplate mutation forbidden` } : { status: mode === 'suspend-denied' ? 1 : 0 };
    };
    if (mode === 'policy-denial') antiRceGate(k); else assert.throws(() => antiRceGate(k));
    assert.equal(neutralized, mode !== 'policy-denial');
  });
  const dir = mkdtempSync(join(tmpdir(), 'idp-test-')); const previous = process.env.IDP_SYNC_WORKDIR;
  process.env.IDP_SYNC_WORKDIR = join(dir, 'private');
  try {
    await check('Secret replacement preflights both files before any write and protects modes', () => {
      const values = { SENTROPIC_IDP_RELAY_WRITER_S3_ACCESS_KEY: 'A'.repeat(32), SENTROPIC_IDP_RELAY_WRITER_S3_SECRET_KEY: 'B'.repeat(32), SENTROPIC_IDP_IDENTITY_READER_PG_PASSWORD: 'C'.repeat(32), SENTROPIC_IDP_RELAY_S3_BUCKET: 'sentropic-idp-identity-relay', SENTROPIC_IDP_RELAY_S3_ENDPOINT: 'https://s3.bhs.io.cloud.ovh.net', SENTROPIC_IDP_RELAY_S3_REGION: 'bhs' };
      const writes = [];
      const k = args => { if (args.includes('get')) return { stdout: '{"metadata":{"resourceVersion":"1"}}' }; writes.push(args.includes('--dry-run=server')); assert.equal(statSync(args[args.indexOf('-f') + 1]).mode & 0o777, 0o600); return {}; };
      replaceSecrets(k, values); assert.deepEqual(writes, [true, true, false, false]); assert.equal(statSync(process.env.IDP_SYNC_WORKDIR).mode & 0o777, 0o700);
      writes.length = 0; assert.throws(() => replaceSecrets(args => { if (args.includes('replace')) throw new Error('preflight rejected'); return k(args); }, values)); assert.deepEqual(writes, []);
    });
    await check('prod kubeconfig host mismatch fails before workload calls', () => {
      process.env.KUBE_CONFIG_DATA = Buffer.from('apiVersion: v1').toString('base64'); process.env.EXPECTED_KUBE_APISERVER_HOST_PROD = 'expected.invalid';
      assert.throws(() => configure('prod', () => ({ stdout: '{"clusters":[{"cluster":{"server":"https://wrong.invalid"}}]}' })), /host mismatch/);
      delete process.env.KUBE_CONFIG_DATA; delete process.env.EXPECTED_KUBE_APISERVER_HOST_PROD;
    });
  } finally { rmSync(dir, { recursive: true, force: true }); if (previous === undefined) delete process.env.IDP_SYNC_WORKDIR; else process.env.IDP_SYNC_WORKDIR = previous; }
  await check('audit rejects invalid outcomes/counts and strips non-audit fields', () => {
    const value = { outcome: 'rolled_back', synced_users: 8, synced_webauthn: 18, rekeyed: 0, preprod_only_kept: 1, post_users: 9, post_webauthn: 22, rekey_dropped_sessions: 9, rekey_moved_webauthn: 8, rekey_pairs: [], forbidden: 'discard' };
    assert.equal(Object.hasOwn(auditSummary(JSON.stringify(value), 'rolled_back'), 'forbidden'), false);
    assert.throws(() => auditSummary(JSON.stringify(value), 'committed')); assert.throws(() => auditSummary(JSON.stringify({ ...value, post_users: -1 }), 'rolled_back'));
    const k = args => ({ stdout: args.includes('logs') ? 'non-audit line\n' : JSON.stringify({ items: [{ status: { containerStatuses: [{ name: 'import-preprod', state: { terminated: { message: JSON.stringify(value) } } }] } }] }) });
    assert.equal(collectAudit('test', 'rolled_back', k).post_users, 9);
  });
  return passed;
}
