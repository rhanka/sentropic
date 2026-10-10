import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { render, validateRun, classifyJobStatus, exportSnapshot, configure, waitJob, failureSummary } from './run-core.mjs';
import { antiRceGate, replaceSecrets, policyName } from './bundle-cd.mjs';
import { auditSummary, collectAudit, failureVerdict, importSnapshot } from './run.mjs';
const { parse } = createRequire('/tmp/idp-tools/package.json')('yaml');
export async function runTests(load, bundles) {
  let passed = 0;
  const check = async (name, fn) => {
    const stdout = process.stdout.write, stderr = process.stderr.write;
    const summary = process.env.GITHUB_STEP_SUMMARY;
    // Exercise production printers without publishing fixtures or a step summary.
    process.stdout.write = process.stderr.write = (_chunk, encoding, callback) => {
      if (typeof encoding === 'function') encoding(); else callback?.();
      return true;
    };
    delete process.env.GITHUB_STEP_SUMMARY;
    try { await fn(); }
    finally {
      process.stdout.write = stdout; process.stderr.write = stderr;
      if (summary === undefined) delete process.env.GITHUB_STEP_SUMMARY; else process.env.GITHUB_STEP_SUMMARY = summary;
    }
    passed++; console.log(`PASS: ${name}`);
  };
  const path = name => new URL(name, import.meta.url);
  const now = new Date('2026-10-03T12:00:00Z');
  const env = { GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', DRY_RUN: '1' };
  await check('manual dry-run and dated real-run validation', () => {
    assert.equal(validateRun(env, now).DRY_RUN, '1');
    assert.throws(() => validateRun({ ...env, DRY_RUN: '0' }, now));
    assert.equal(validateRun({ ...env, DRY_RUN: '0', CONFIRM: 'idp-sync-2026-10-03' }, now).DRY_RUN, '0');
    assert.equal(validateRun({ ...env, ALLOWED_CLIENTS: ' immo-mcp, other-client ' }, now).ALLOWED_CLIENTS, 'immo-mcp,other-client');
    for (const patch of [{ GITHUB_REF: 'refs/heads/evil' }, { DRY_RUN: 'true' }, { ALLOWED_REKEY: 'invalid' }, { MAX_SNAPSHOT_AGE_S: '0' }, { CONFIRM: 'idp-sync-2026-10-02', DRY_RUN: '0' }, ...['immo-mcp,immo-mcp', 'immo-mcp,', 'bad/client', 'a\n'].map(ALLOWED_CLIENTS => ({ ALLOWED_CLIENTS: ALLOWED_CLIENTS === 'a\n' ? 'a\nb' : ALLOWED_CLIENTS }))]) assert.throws(() => validateRun({ ...env, ...patch }, now));
  });
  await check('scheduled import forces real run with empty rekey allowlist', () => {
    assert.deepEqual(validateRun({ ...env, GITHUB_EVENT_NAME: 'schedule', ALLOWED_REKEY: 'invalid', ALLOWED_CLIENTS: 'immo-mcp' }, now), { DRY_RUN: '0', ALLOWED_REKEY: '', ALLOWED_CLIENTS: '', MAX_SNAPSHOT_AGE_S: '7200' });
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
  await check('import refreshes the matching preprod bundle before creating a Job against a stale importer', async () => {
    const calls = []; let refreshed = false;
    const audit = { outcome: 'committed', rekey_pairs: [], synced_users: 8, synced_webauthn: 18,
      rekeyed: 0, preprod_only_kept: 0, post_users: 8, post_webauthn: 18,
      rekey_dropped_sessions: 0, rekey_moved_webauthn: 0, consents_upserted: 0,
      consents_removed: 0, clients_upserted: 1, clients_removed: 0, clients_skipped_confidential: 0 };
    const k = (args, options) => {
      calls.push(args);
      if (args.includes('-k')) { refreshed = true; return {}; }
      if (args.includes('apply')) {
        assert(refreshed, 'a stale four-file importer would reject the five-file client manifest');
        const job = loadText(options.input);
        assert.equal(job.spec.template.spec.containers[0].env.find(e => e.name === 'ALLOWED_CLIENTS').value, 'immo-mcp');
      }
      return { stdout: args.includes('pods') ? JSON.stringify({ items: [{ status: { containerStatuses: [
        { name: 'import-preprod', state: { terminated: { message: JSON.stringify(audit) } } },
      ] } }] }) : '' };
    };
    const inputs = validateRun({ ...env, DRY_RUN: '0', CONFIRM: 'idp-sync-2026-10-03', ALLOWED_CLIENTS: 'immo-mcp' }, now);
    assert.deepEqual(await importSnapshot(inputs, '123-1', k, async () => 'complete'), audit);
    assert.deepEqual(calls[0], ['apply', '-k', 'deploy/k8s/overlays/preprod/idp-identity-sync']);
    assert.equal(calls[1][2], 'delete'); assert.equal(calls[2][2], 'apply');
  });
  await check('failed importer bundle delivery prevents Job creation and waiting', async () => {
    const calls = []; let waited = false;
    await assert.rejects(importSnapshot(validateRun(env, now), '123-1', args => {
      calls.push(args); throw new Error('bundle rejected');
    }, async () => { waited = true; }), /bundle rejected/);
    assert.deepEqual(calls, [['apply', '-k', 'deploy/k8s/overlays/preprod/idp-identity-sync']]);
    assert.equal(waited, false);
  });
  await check('Job status distinguishes pending, active, complete and failed', async () => {
    for (const [status, expected] of [[{}, 'pending'], [{ active: 1 }, 'active'], [{ succeeded: 1 }, 'complete'], [{ conditions: [{ type: 'Complete', status: 'True' }] }, 'complete'], [{ failed: 1, succeeded: 1 }, 'failed'], [{ conditions: [{ type: 'Failed', status: 'True' }] }, 'failed']]) assert.equal(classifyJobStatus(status), expected);
    let calls = 0;
    assert.equal(await waitJob('test', 'job', 1, () => ({ stdout: JSON.stringify({ status: ++calls === 1 ? { active: 1 } : { succeeded: 1 } }) }), async () => {}), 'complete');
  });
  await check('rendered prod export reports user, WebAuthn and consent counts only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'idp-export-test-'));
    try {
      writeFileSync(join(dir, 'snapshot.csv'), '2026-10-04 00:00:00,108,118,128,138\n');
      const script = bundles.prod.find(o => o.kind === 'CronJob').spec.jobTemplate.spec.template.spec.initContainers[0].args[0];
      const reporting = script.slice(script.indexOf('IFS=, read')).replace('/dev/termination-log', './termination.json');
      const result = spawnSync('sh', ['-ec', reporting], { cwd: dir, encoding: 'utf8' });
      assert.equal(result.status, 0); assert.equal(result.stderr, '');
      assert.equal(result.stdout, 'users=108 webauthn=118 consents=128 clients=138\n');
      assert.deepEqual(JSON.parse(readFileSync(join(dir, 'termination.json'), 'utf8')), { users: 108, webauthn: 118, consents: 128, clients: 138 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  for (const verdict of ['complete', 'failed', 'invalid', 'zero-consents', 'missing-consents', 'invalid-consents', 'negative-consents', 'fractional-consents', 'unsafe-consents']) await check(`export ${verdict} always re-suspends and uses pod status only`, async () => {
    const patches = []; let lists = 0;
    const consentCounts = { 'zero-consents': 0, 'missing-consents': undefined, 'invalid-consents': 'private@example.invalid', 'negative-consents': -1, 'fractional-consents': 1.5, 'unsafe-consents': Number.MAX_SAFE_INTEGER + 1 };
    const consents = Object.hasOwn(consentCounts, verdict) ? consentCounts[verdict] : 128;
    const old = { metadata: { uid: 'old', name: 'old', ownerReferences: [{ uid: 'cron' }] }, status: { succeeded: 1 } };
    const fresh = { metadata: { uid: 'fresh', name: 'fresh', ownerReferences: [{ uid: 'cron' }] } };
    const k = args => {
      assert.ok(!args.includes('logs'));
      if (args.includes('patch')) { patches.push(JSON.parse(args.at(-1)).spec.suspend); return {}; }
      const resource = args[args.indexOf('get') + 1];
      const data = resource === 'cronjob' ? { metadata: { uid: 'cron' }, spec: { suspend: true } }
        : resource === 'jobs' ? { items: ++lists === 1 ? [old] : [old, fresh] }
        : resource === 'job' ? { status: verdict === 'failed' ? { failed: 1 } : { succeeded: 1 } }
        : { items: [{ status: { initContainerStatuses: [{ name: 'export', state: { terminated: { message: JSON.stringify({ users: verdict === 'invalid' ? 0 : 108, webauthn: 118, consents, clients: 138, forbidden: 'private@example.invalid' }) } } }] } }] };
      if (resource === 'job') assert.equal(args[4], 'fresh');
      return { stdout: JSON.stringify(data) };
    };
    const output = [], log = console.log;
    console.log = value => output.push(value);
    try {
      if (['complete', 'zero-consents'].includes(verdict)) assert.equal(await exportSnapshot(k, async () => {}), 'fresh');
      else await assert.rejects(exportSnapshot(k, async () => {}), { message: verdict === 'failed' ? 'prod export Job failed' : 'invalid export termination verdict' });
    } finally { console.log = log; }
    assert.deepEqual(output, ['complete', 'zero-consents'].includes(verdict) ? [`export users=108 webauthn=118 consents=${consents} clients=138`] : []);
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
    const value = { outcome: 'rolled_back', synced_users: 101, synced_webauthn: 118, rekeyed: 1, preprod_only_kept: 103, post_users: 109, post_webauthn: 122, rekey_dropped_sessions: 104, rekey_moved_webauthn: 105, consents_upserted: 106, consents_removed: 107, clients_upserted: 0, clients_removed: 0, clients_skipped_confidential: 0, rekey_pairs: [{ old_id: '00000000-0000-4000-8000-000000000001', new_id: '00000000-0000-4000-8000-000000000002' }], forbidden: 'discard' };
    assert.equal(Object.hasOwn(auditSummary(JSON.stringify(value), 'rolled_back'), 'forbidden'), false);
    assert.throws(() => auditSummary(JSON.stringify(value), 'committed')); assert.throws(() => auditSummary(JSON.stringify({ ...value, post_users: -1 }), 'rolled_back'));
    const k = args => ({ stdout: args.includes('logs') ? 'non-audit line\n' : JSON.stringify({ items: [{ status: { containerStatuses: [{ name: 'import-preprod', state: { terminated: { message: JSON.stringify(value) } } }] } }] }) });
    assert.equal(collectAudit('synthetic', 'rolled_back', k).post_users, 109);
    for (const key of ['consents_upserted', 'consents_removed', 'clients_upserted', 'clients_removed', 'clients_skipped_confidential']) {
      assert.throws(() => auditSummary(JSON.stringify({ ...value, [key]: -1 }), 'rolled_back'));
      const missing = { ...value }; delete missing[key];
      assert.throws(() => auditSummary(JSON.stringify(missing), 'rolled_back'));
    }
  });
  await check('failed imports report only known codes and strict UUID pairs from pod status', () => {
    const pair = '00000000-0000-4000-8000-000000000001>00000000-0000-4000-8000-000000000002';
    const value = { outcome: 'failed', code: 'rekey_not_allowed', rejected_rekey_pairs: [pair] };
    assert.deepEqual(failureSummary(JSON.stringify(value)), value);
    for (const code of ['invalid_dry_run', 'invalid_age_limit', 'invalid_manifest', 'integrity_failed', 'invalid_counts', 'invalid_timestamp', 'stale_snapshot', 'manifest_mismatch', 'empty_export', 'dv5_invariant_changed', 'postcondition_failed', 'lock_timeout', 'sql_error', 'invalid_audit', 'consent_client_missing', 'consent_postcondition_failed', 'client_source_missing', 'client_policy_invalid', 'client_postcondition_failed']) assert.equal(failureSummary(JSON.stringify({ outcome: 'failed', code })).code, code);
    const pod = message => ({ stdout: JSON.stringify({ items: [{ status: { containerStatuses: [{ name: 'import-preprod', state: { terminated: { message } } }] } }] }) });
    assert.equal(failureVerdict('synthetic', args => { assert.ok(!args.includes('logs')); return pod(JSON.stringify(value)); }), `job/synthetic failed: rekey_not_allowed (${pair})`);
    assert.equal(failureVerdict('synthetic', () => pod('{"outcome":"failed","code":"sql_error"}')), 'job/synthetic failed: sql_error');
    const pair2 = '00000000-0000-4000-8000-000000000003>00000000-0000-4000-8000-000000000004';
    const multi = JSON.stringify({ ...value, rejected_rekey_pairs: [pair, pair2] });
    assert.equal(failureVerdict('synthetic', () => pod(multi)), `job/synthetic failed: rekey_not_allowed (${pair},${pair2})`);
    const latest = JSON.parse(pod(multi).stdout).items[0];
    latest.status.containerStatuses.push({ name: 'sidecar', state: { terminated: { message: 'private@example.invalid' } } });
    latest.status.initContainerStatuses = [{ name: 'import-preprod', state: { terminated: { message: 'private@example.invalid' } } }];
    assert.equal(failureVerdict('synthetic', () => ({ stdout: JSON.stringify({ items: [...JSON.parse(pod('OOMKilled').stdout).items, latest] }) })), `job/synthetic failed: rekey_not_allowed (${pair},${pair2})`);
    assert.throws(() => failureVerdict('synthetic', () => ({ stdout: JSON.stringify({ items: [latest, ...JSON.parse(pod('OOMKilled').stdout).items] }) })), { message: 'job/synthetic failed: termination failure code unavailable' });
    const empty = JSON.stringify({ ...value, rejected_rekey_pairs: [] });
    assert.deepEqual(failureSummary(empty).rejected_rekey_pairs, []);
    assert.equal(failureVerdict('synthetic', () => pod(empty)), 'job/synthetic failed: rekey_not_allowed');
    assert.throws(() => failureSummary(JSON.stringify({ ...value, rejected_rekey_pairs: [pair.replace(/1/g, 'A')] })), { message: 'invalid import failure message' });
    const invalid = ['private@example.invalid', 'null', '[]', '{"outcome":', JSON.stringify({ ...value, outcome: 'committed' }), JSON.stringify({ ...value, code: 'private@example.invalid' }), JSON.stringify({ ...value, rejected_rekey_pairs: ['private@example.invalid'] }), JSON.stringify({ ...value, rejected_rekey_pairs: ['-'.repeat(36) + '>' + '-'.repeat(36)] }), JSON.stringify({ ...value, rejected_rekey_pairs: [pair + '\n'] }), JSON.stringify({ ...value, stderr: 'private@example.invalid' }), JSON.stringify({ ...value, code: 'sql_error' })];
    for (const raw of invalid) {
      assert.throws(() => failureSummary(raw), { message: 'invalid import failure message' });
      assert.throws(() => failureVerdict('synthetic', () => pod(raw)), { message: 'job/synthetic failed: termination failure code unavailable' });
    }
    for (const stdout of ['private@example.invalid', '{"items":[]}']) assert.throws(() => failureVerdict('synthetic', () => ({ stdout })), { message: 'job/synthetic failed: termination failure code unavailable' });
  });
  return passed;
}
