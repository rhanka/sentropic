import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { checkBundle } from './bundle-checks.mjs';
import { runTests } from './run.selftest.mjs';
import { workflowTests } from './workflow.selftest.mjs';
const { parseAllDocuments } = createRequire('/tmp/idp-tools/package.json')('yaml');
const load = file => parseAllDocuments(readFileSync(file, 'utf8')).map(doc => { assert.deepEqual(doc.errors, []); return doc.toJS(); }).filter(Boolean);
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS: ${name}`); };
const bundles = {};
for (const tier of ['prod', 'preprod']) {
  bundles[tier] = load(`/rendered/${tier}.yaml`);
  check(`${tier} kustomize bundle safety`, () => checkBundle(bundles[tier], tier));
  check(`${tier} parent overlay includes identical sync objects`, () => {
    const parent = load(`/rendered/${tier}-parent.yaml`);
    for (const child of bundles[tier]) assert.deepEqual(parent.find(o => o.kind === child.kind && o.metadata.name === child.metadata.name), child);
  });
}
const mutated = (tier, mutation) => { const copy = structuredClone(bundles[tier]); mutation(copy); assert.throws(() => checkBundle(copy, tier)); };
const cron = objects => objects.find(o => o.kind === 'CronJob');
check('reject armed export CronJob', () => mutated('prod', o => { cron(o).spec.suspend = false; }));
check('reject unpinned image', () => mutated('prod', o => { cron(o).spec.jobTemplate.spec.template.spec.containers[0].image = 'postgres:17-alpine'; }));
check('reject preprod prod-credential reference', () => mutated('preprod', o => { cron(o).spec.jobTemplate.spec.template.spec.containers[0].env.find(e => e.name === 'PGPASSWORD').valueFrom.secretKeyRef.name = 'sentropic-idp-identity-reader'; }));
check('reject preprod real-run default', () => mutated('preprod', o => { cron(o).spec.jobTemplate.spec.template.spec.containers[0].env.find(e => e.name === 'DRY_RUN').value = '0'; }));
check('reject arbitrary-job delegation', () => mutated('prod', o => { o.find(x => x.kind === 'Role').rules[1].verbs.push('create'); }));
check('reject prod trigger namespace-wide pod logs', () => mutated('prod', o => { o.find(x => x.kind === 'Role').rules[2].resources.push('pods/log'); }));
check('reject s5cmd shell assumption', () => mutated('preprod', o => { cron(o).spec.jobTemplate.spec.template.spec.initContainers[1].command = ['sh', '-c']; }));
passed += await runTests(load, bundles);
workflowTests(check, load);
console.log(`${passed} PASS, 0 failures`);
