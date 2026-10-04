import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkBundle, postgresImage, s5cmdImage } from './bundle-checks.mjs';
import { runTests } from './run.selftest.mjs';
import { workflowTests } from './workflow.selftest.mjs';
const { parseAllDocuments } = createRequire('/tmp/idp-tools/package.json')('yaml');
const load = file => parseAllDocuments(readFileSync(file, 'utf8')).map(doc => { assert.deepEqual(doc.errors, []); return doc.toJS(); }).filter(Boolean);
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS: ${name}`); };
const bundles = {};
const filesUnder = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? filesUnder(path) : [path];
});
check('no legacy AWS CLI image or apk installation in Kubernetes sources and Makefile', () => {
  for (const file of [...filesUnder('deploy/k8s'), 'Makefile']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /amazon\/aws-cli|\bapk\s+add\b[^;&|]*\baws-cli\b/, file);
  }
});
for (const tier of ['prod', 'preprod']) {
  bundles[tier] = load(`/rendered/${tier}.yaml`);
  check(`${tier} kustomize bundle safety`, () => checkBundle(bundles[tier], tier));
  check(`${tier} parent overlay includes identical sync objects`, () => {
    const parent = load(`/rendered/${tier}-parent.yaml`);
    for (const child of bundles[tier]) assert.deepEqual(parent.find(o => o.kind === child.kind && o.metadata.name === child.metadata.name), child);
  });
  check(`${tier} parent overlay pgbackup uses approved pinned Postgres and s5cmd images`, () => {
    const backups = load(`/rendered/${tier}-parent.yaml`).filter(o => o.kind === 'CronJob' && o.metadata.name === 'pgbackup');
    assert.equal(backups.length, 1);
    const pod = backups[0].spec.jobTemplate.spec.template.spec;
    assert.deepEqual(pod.initContainers.map(c => [c.name, c.image]), [['dump', postgresImage]]);
    assert.deepEqual(pod.containers.map(c => [c.name, c.image]), [['upload', s5cmdImage]]);
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
if (!process.argv.includes('--output-probe')) check('selftest output contains no fixture audit or summary', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--output-probe'], { encoding: 'utf8' });
  assert.equal(result.status, 0, 'selftest output probe failed');
  assert.doesNotMatch(result.stdout + result.stderr, /^\{"outcome"/m);
  assert.doesNotMatch(result.stdout + result.stderr, /^(export users=|anti-RCE:|replaced sentropic-idp-)/m);
});
console.log(`${passed} PASS, 0 failures`);
