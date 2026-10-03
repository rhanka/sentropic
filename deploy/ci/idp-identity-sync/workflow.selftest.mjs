import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { parse } = createRequire('/tmp/idp-tools/package.json')('yaml');
export function workflowTests(check, load) {
  const workflow = load('.github/workflows/idp-identity-sync.yml')[0];
  const ci = load('.github/workflows/ci.yml')[0];
  function wiring(w) {
    assert.deepEqual(w.on.push.branches, ['main']);
    assert.equal(w.on.schedule[0].cron, '40 4 * * *');
    assert.equal(w.on.workflow_dispatch.inputs.DRY_RUN.default, true);
    assert.equal(w.on.workflow_dispatch.inputs.ALLOWED_REKEY.default, '');
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
