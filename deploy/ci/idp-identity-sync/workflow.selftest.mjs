import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const { parse } = createRequire('/tmp/idp-tools/package.json')('yaml');
export function workflowTests(check, load) {
  const workflow = load('.github/workflows/idp-identity-sync.yml')[0];
  const ci = load('.github/workflows/ci.yml')[0];
  const workload = load('.github/workflows/idp-workload-secret.yml')[0];
  const workloadSteps = workload.jobs['materialize-preprod-workload-secret'].steps;
  const materialize = workloadSteps.find(s => s.env?.IMMO_MCP_WORKLOAD_CLIENT_SECRET);
  check('workload Secret workflow is dispatch-only, protected, main-only and always cleans up', () => {
    assert.deepEqual(Object.keys(workload.on), ['workflow_dispatch']);
    assert.deepEqual(Object.keys(workload.jobs), ['materialize-preprod-workload-secret']);
    assert.equal(workload.jobs['materialize-preprod-workload-secret'].environment, 'sentropic-idp-run');
    assert.equal(workload.jobs['materialize-preprod-workload-secret'].if, "github.ref == 'refs/heads/main'");
    assert.deepEqual(workload.permissions, { contents: 'read' });
    assert.equal(workload.concurrency['cancel-in-progress'], false);
    const reference = workflow.jobs.run.steps;
    assert.deepEqual(workloadSteps.slice(0, 3), reference.slice(0, 3));
    assert.equal(workloadSteps[1].with['node-version'], '24');
    assert.deepEqual(workloadSteps[3], {
      name: 'Configure preprod identity', env: { KUBE_CONFIG_DATA: '${{ secrets.KUBE_CONFIG_DATA_PREPROD }}' },
      run: 'node deploy/ci/idp-identity-sync/run.mjs configure preprod',
    });
    assert.equal(materialize.env.IMMO_MCP_WORKLOAD_CLIENT_SECRET, '${{ secrets.IMMO_MCP_WORKLOAD_CLIENT_SECRET }}');
    assert.equal(workloadSteps.at(-1).if, 'always()');
    assert.equal(workloadSteps.at(-1).run, 'node deploy/ci/idp-identity-sync/run.mjs cleanup');
    for (const step of workloadSteps) assert.doesNotMatch(step.run || '', /\$\{\{|\becho\b|\bprintenv\b|set -x/);
  });
  check('workload materialization validates credentials, protects the manifest and suppresses diagnostics', () => {
    const source = /^node --input-type=module <<'NODE'\n([\s\S]+)\nNODE\n?$/.exec(materialize.run)?.[1];
    assert.ok(source, 'materialization must run in Node without shell value handling');
    const directory = mkdtempSync(join(tmpdir(), 'workload-selftest-'));
    try {
      const workdir = join(directory, 'private'), receipt = join(directory, 'receipt.json');
      mkdirSync(workdir, { mode: 0o700 });
      writeFileSync(join(directory, 'kubectl'), `#!${process.execPath}
        const fs = require('node:fs'), assert = require('node:assert/strict');
        const args = process.argv.slice(2), file = args.at(-1);
        assert.deepEqual(args.slice(0, -1), ['--kubeconfig', process.env.IDP_SYNC_WORKDIR + '/kubeconfig', '-n', 'sentropic-preprod', 'apply', '-f']);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        fs.writeFileSync(process.env.RECEIPT, fs.readFileSync(file));
        if (process.env.APPLY_STATUS === 'failed') { console.error(process.env.IMMO_MCP_WORKLOAD_CLIENT_SECRET); process.exit(1); }
        console.log('secret/immo-mcp-workload ' + process.env.APPLY_STATUS);
      `, { mode: 0o700 });
      const value = 'ab'.repeat(32);
      const execute = (credential, status) => {
        rmSync(receipt, { force: true });
        const result = spawnSync(process.execPath, ['--input-type=module'], { input: source, encoding: 'utf8',
          env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, IDP_SYNC_WORKDIR: workdir,
            RECEIPT: receipt, APPLY_STATUS: status, IMMO_MCP_WORKLOAD_CLIENT_SECRET: credential } });
        assert.doesNotMatch(result.stdout + result.stderr, new RegExp(value));
        assert.deepEqual(readdirSync(workdir), [], 'temporary manifests must be removed');
        return result;
      };
      for (const status of ['created', 'configured', 'unchanged']) {
        const result = execute(value, status);
        assert.equal(result.status, 0); assert.equal(result.stderr, '');
        assert.deepEqual(JSON.parse(result.stdout), { name: 'immo-mcp-workload', namespace: 'sentropic-preprod',
          status: status === 'unchanged' ? 'configured' : status,
          fingerprint: createHash('sha256').update(value).digest('hex').slice(0, 8) });
        assert.deepEqual(JSON.parse(readFileSync(receipt, 'utf8')), { apiVersion: 'v1', kind: 'Secret',
          metadata: { name: 'immo-mcp-workload', namespace: 'sentropic-preprod' }, type: 'Opaque',
          data: { IMMO_MCP_WORKLOAD_CLIENT_SECRET: Buffer.from(value).toString('base64') } });
      }
      for (const invalid of ['', value.toUpperCase(), value + '\n', value.slice(1), 'g'.repeat(64)]) {
        const result = execute(invalid, 'created');
        assert.equal(result.status, 1); assert.equal(result.stdout, '');
        assert.equal(result.stderr, 'workload_credential_invalid\n');
        assert.throws(() => readFileSync(receipt), { code: 'ENOENT' });
      }
      for (const status of ['failed', 'unexpected']) {
        const result = execute(value, status);
        assert.equal(result.status, 1); assert.equal(result.stdout, '');
        assert.equal(result.stderr, 'workload_secret_apply_failed\n');
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  function wiring(w) {
    assert.deepEqual(w.on.push.branches, ['main']);
    assert.equal(w.on.schedule[0].cron, '40 4 * * *');
    assert.equal(w.on.workflow_dispatch.inputs.DRY_RUN.default, true);
    assert.equal(w.on.workflow_dispatch.inputs.ALLOWED_REKEY.default, '');
    assert.equal(w.on.workflow_dispatch.inputs.ALLOWED_CLIENTS.default, '');
    assert.equal(w.jobs.run.env.ALLOWED_CLIENTS, "${{ github.event_name == 'schedule' && '' || inputs.ALLOWED_CLIENTS || '' }}");
    assert.equal(w.concurrency['cancel-in-progress'], false);
    assert.equal(w.jobs['bundle-prod'].environment, 'sentropic-idp-prod');
    assert.match(w.jobs['bundle-prod'].if, /vars.IDP_SYNC_CD_ENABLED == 'true'/);
    assert.match(w.jobs['bundle-prod'].if, /refs\/heads\/main/);
    assert.equal(w.jobs.run.environment, 'sentropic-idp-run');
    assert.match(w.jobs.run.if, /vars.IDP_SYNC_SCHEDULE_ENABLED == 'true'/);
    assert.match(w.jobs.run.if, /refs\/heads\/main/);
    const steps = w.jobs.run.steps;
    const action = name => steps.findIndex(s => s.run?.endsWith(`run.mjs ${name}`));
    assert.ok(action('validate') < action('configure prod'));
    assert.ok(action('export') < action('resuspend') && action('resuspend') < action('configure preprod'));
    assert.match(steps[action('resuspend')].if, /always\(\)/);
    assert.match(steps[action('resuspend')].if, /prod-config.outcome == 'success'/);
    assert.equal(steps[action('configure prod')].env.KUBE_CONFIG_DATA, '${{ secrets.KUBE_CONFIG_DATA_IDP_TRIGGER_PROD }}');
    assert.equal(steps[action('configure preprod')].env.KUBE_CONFIG_DATA, '${{ secrets.KUBE_CONFIG_DATA_PREPROD }}');
    for (const [name, job] of Object.entries(w.jobs)) for (const step of job.steps) {
      assert.ok(!step.run?.includes('${{'), 'expressions belong in env, never shell commands');
      if (JSON.stringify(step).includes('KUBE_CONFIG_DATA_IDP_TRIGGER_PROD')) assert.equal(name, 'run');
      if (JSON.stringify(step).includes('KUBE_CONFIG_DATA_IDP_BUNDLE_PROD')) assert.equal(name, 'bundle-prod');
    }
    assert.match(w.jobs.selftest.steps.find(s => s.run).run, /^make test-idp-sync-selftest ENV=test-idp-sync$/);
  }
  check('workflow main-only arming, defaults, identity separation and always re-suspend', () => wiring(workflow));
  check('reject expression injection in workflow run commands', () => {
    const copy = structuredClone(workflow); copy.jobs.run.steps.push({ run: 'echo ${{ inputs.ALLOWED_REKEY }}' }); assert.throws(() => wiring(copy));
  });
  check('reject missing export cleanup and unsafe dispatch default', () => {
    const copy = structuredClone(workflow); copy.jobs.run.steps.find(s => s.run?.endsWith(' resuspend')).if = 'success()'; assert.throws(() => wiring(copy));
    const other = structuredClone(workflow); other.on.workflow_dispatch.inputs.DRY_RUN.default = false; assert.throws(() => wiring(other));
  });
  check('CI gates SQL and bundles for deployment changes', () => {
    const filter = parse(ci.jobs.changes.steps.find(s => s.with?.filters).with.filters);
    assert.ok(filter.idp_sync.includes('deploy/**'));
    assert.ok(filter.idp_sync.includes('packages/auth-hono/src/**'));
    assert.ok(filter.idp_sync.includes('packages/auth-hono/package.json'));
    assert.deepEqual(ci.jobs['validate-idp-sync'].steps.filter(s => s.run).map(s => s.run), ['make test-idp-sync-selftest ENV=test-idp-sync', 'make test-idp-sync-sql ENV=test-idp-sync']);
  });
  check('bootstrap delegates only tenant resources and two existing Secrets', () => {
    const objects = load('deploy/ci/idp-identity-sync/rbac-ci-idp-bundle-prod.yaml');
    assert.ok(objects.every(o => o.metadata.namespace === 'sentropic'));
    const rules = objects.find(o => o.kind === 'Role').rules;
    assert.ok(rules.every(r => !JSON.stringify(r).includes('*') && !r.apiGroups.includes('admissionregistration.k8s.io')));
    const secrets = rules.find(r => r.resources.includes('secrets'));
    assert.deepEqual(secrets.verbs, ['get', 'update']); assert.equal(secrets.resourceNames.length, 2);
    const job = load('deploy/ci/idp-identity-sync/reader-role-provision-job.tmpl.yaml')[0];
    assert.equal(job.spec.backoffLimit, 0); assert.equal(job.spec.activeDeadlineSeconds, 300);
    assert.equal(job.spec.template.spec.automountServiceAccountToken, false);
    assert.equal(job.spec.template.spec.containers[0].env.find(e => e.name === 'RO_PASSWORD').valueFrom.secretKeyRef.name, 'sentropic-idp-identity-reader');
  });
  check('admission policy is k8s-owned and denies trigger pod-template changes', () => {
    const objects = load('deploy/ci/idp-identity-sync/vap-ci-trigger-suspend-only.yaml');
    assert.equal(objects[0].spec.failurePolicy, 'Fail'); assert.deepEqual(objects[1].spec.validationActions, ['Deny']);
    assert.ok(objects[0].spec.validations.some(v => v.expression === 'object.spec.jobTemplate == oldObject.spec.jobTemplate'));
    assert.ok(!readFileSync('deploy/ci/idp-identity-sync/run.mjs', 'utf8').includes('vap-ci-trigger-suspend-only.yaml'));
  });
}
