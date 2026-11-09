// Render contract for the one-off cm_identity account approval Job (38-*) and its Make wrapper.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const YAML = createRequire(path.join(process.env.MANIFEST_GUARD_TOOL_DIR, 'package.json'))('yaml');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const load = (file) => YAML.parseAllDocuments(read(file)).map((doc) => doc.toJSON()).filter(Boolean);

const JOB_FILE = 'deploy/k8s/base/38-cm-account-approve-job.yaml';
const JOB = 'cm-account-approve';
const SECRET = 'cm-account-approval';
// The A4 launcher composes the email-code HMAC custody exactly as for the api pod, then runs the script.
const LAUNCH = ['node', '/run/cm-runtime/launch.mjs', '--script', 'cm-account-approve'];
const A4_API_PATCH = 'deploy/k8s/components/a4-wiring/patch-api-a4.yaml';

// What the Make target applies: the versioned Job with the `approve` image pinned
// (`kubectl set image --local ... approve=<api image>`).
const render = (image) => {
  const [job, ...rest] = load(JOB_FILE);
  assert.equal(rest.length, 0, 'one document only');
  job.spec.template.spec.containers.find((container) => container.name === 'approve').image = image;
  return job;
};

const recipe = () => {
  const makefile = read('Makefile');
  const start = makefile.indexOf(`\n${JOB}-job:`);
  assert.ok(start > 0, 'Make target exists');
  const end = makefile.indexOf('\n\n', start + 1);
  return makefile.slice(start, end);
};

test('the rendered Job runs the dist script once through the A4 launcher with the pinned image', () => {
  const image = 'ghcr.io/rhanka/sentropic-api@sha256:' + 'b'.repeat(64);
  const job = render(image);
  assert.equal(job.kind, 'Job');
  assert.equal(job.metadata.name, JOB);
  assert.equal(job.spec.backoffLimit, 0);
  const pod = job.spec.template.spec;
  assert.equal(job.spec.template.metadata.labels['app.kubernetes.io/component'], JOB);
  assert.equal(pod.restartPolicy, 'Never');
  assert.equal(pod.automountServiceAccountToken, false);
  assert.equal(pod.securityContext.seccompProfile.type, 'RuntimeDefault');
  assert.deepEqual(pod.containers.map((container) => container.name), ['approve']);
  const [container] = pod.containers;
  assert.equal(container.image, image);
  assert.equal(container.workingDir, '/workspace/api');
  assert.deepEqual(container.command, LAUNCH);
  assert.equal(container.args, undefined, 'no CLI literals');
  assert.equal(container.securityContext.allowPrivilegeEscalation, false);
  assert.deepEqual(container.envFrom, [
    { configMapRef: { name: 'api' } },
    { secretRef: { name: 'sentropic-api' } },
    { secretRef: { name: SECRET } },
  ]);
});

test('the Job receives the same HMAC custody wiring and runtime volume as the A4 api pod, nothing more', () => {
  const pod = render('ghcr.io/rhanka/sentropic-api:main').spec.template.spec;
  const [container] = pod.containers;
  const [deployment] = load(A4_API_PATCH);
  const api = deployment.spec.template.spec;
  const apiContainer = api.containers.find((candidate) => candidate.name === 'api');
  const hmac = apiContainer.env.filter((entry) => entry.name.startsWith('EMAIL_CODE_HMAC_'));
  assert.equal(hmac.length, 4, 'active and previous key plus their refs');
  const namespace = { name: 'CM_A4_NAMESPACE', valueFrom: { fieldRef: { fieldPath: 'metadata.namespace' } } };
  assert.deepEqual(apiContainer.env.find((entry) => entry.name === 'CM_A4_NAMESPACE'), namespace);
  assert.deepEqual(container.env.find((entry) => entry.name === 'CM_A4_NAMESPACE'), namespace);
  const jobHmac = container.env.filter((entry) => entry.name !== 'CM_A4_NAMESPACE');
  for (const entry of jobHmac) {
    assert.equal(entry.value, undefined, `${entry.name}: no literal value`);
    assert.equal(entry.valueFrom.secretKeyRef.name, 'email-code-hmac');
  }
  assert.deepEqual(jobHmac, hmac);
  assert.deepEqual(container.volumeMounts, [{ name: 'cm-runtime', mountPath: '/run/cm-runtime', readOnly: true }]);
  assert.deepEqual(pod.volumes, [api.volumes.find((volume) => volume.name === 'cm-runtime')]);
  assert.equal(pod.volumes[0].configMap.name, 'sentropic-a4-runtime');
});

test('the dist script is built into the api image and the Job stays out of kustomize', () => {
  assert.ok(fs.existsSync(path.join(root, 'api/src/scripts/cm-account-approve.ts')));
  const build = JSON.parse(read('api/package.json')).scripts.build;
  assert.match(build, /esbuild src\/scripts\/cm-account-approve\.ts .*--outfile=dist\/scripts\/cm-account-approve\.js/);
  const [kustomization] = load('deploy/k8s/base/kustomization.yaml');
  assert.ok(!kustomization.resources.includes(path.basename(JOB_FILE)), 'one-off Job is never a kustomize resource');
});

test('a dedicated network policy admits only the Job pod to postgres:5432', () => {
  const policy = load('deploy/k8s/base/15-networkpolicy.yaml')
    .find((doc) => doc.metadata?.name === `allow-${JOB}-to-postgres`);
  assert.ok(policy, 'policy exists');
  assert.equal(policy.spec.podSelector.matchLabels['app.kubernetes.io/component'], 'postgres');
  assert.deepEqual(policy.spec.ingress, [{
    from: [{ podSelector: { matchLabels: { 'app.kubernetes.io/name': 'sentropic', 'app.kubernetes.io/component': JOB } } }],
    ports: [{ protocol: 'TCP', port: 5432 }],
  }]);
});

test('the Make wrapper guards the 0600 file, pins the image, records the reason and cleans up on exit', () => {
  const body = recipe();
  assert.match(body, /stat -c %a "\$\$FILE"\)" in 600\|400\)/);
  assert.ok(body.includes("CM_ACCOUNT_APPROVE_(ACTOR_ID|USER_ID|ROLE|REASON)=.*)$$'"), 'only the four keys are accepted');
  assert.ok(body.includes('for k in ACTOR_ID USER_ID ROLE REASON;'), 'each key is required exactly once');
  assert.match(body, /get deployment\/api -o jsonpath=/);
  assert.ok(body.includes(`kubectl set image --local -f ${JOB_FILE} approve="$$IMG" -o yaml`));
  assert.ok(body.includes('kubectl annotate --local -f - sentropic.io/approval-reason="$$REASON" -o yaml'));
  assert.ok(body.includes(`create secret generic ${SECRET} --from-env-file="$$FILE" >/dev/null`));
  const trap = body.match(/trap '([^']*)' EXIT/);
  assert.ok(trap, 'cleanup trap on EXIT');
  assert.ok(trap[1].includes(`delete job/${JOB}`) && trap[1].includes(`delete secret/${SECRET}`));
  assert.ok(body.indexOf('trap ') < body.indexOf('create secret generic'), 'trap is armed before the Secret exists');
  // An older namespace launcher would pass --script to dist/index.js and boot a second api (migrations,
  // lock purge): the wrapper refuses before creating anything unless the namespace serves the script mode.
  const preflight = body.indexOf("get configmap sentropic-a4-runtime -o jsonpath='{.data.launch\\.mjs}'");
  assert.ok(preflight > 0, 'launcher preflight reads the namespace runtime ConfigMap');
  const marker = "args[0] === '--script'";
  assert.ok(read('deploy/k8s/overlays/preprod/a4-runtime/launch.mjs').includes(marker), 'the shipped launcher carries the marker');
  const check = body.slice(preflight, body.indexOf('trap '));
  assert.ok(check.includes(`grep -qF "${marker}"`), 'preflight requires the --script mode');
  assert.match(check, /\|\| \{ echo "ERROR: [^"]+"; exit 1; \}; \\\n\t$/, 'a missing mode refuses with exit 1');
  assert.ok(!check.includes('2>/dev/null'), 'kubectl errors (RBAC, connection) stay visible');
  assert.ok(preflight < body.indexOf('trap ') && preflight < body.indexOf('create secret generic'), 'preflight runs first');
  assert.ok(!/cat |echo "\$\$\(cat/.test(body), 'the env file is never printed');
});
