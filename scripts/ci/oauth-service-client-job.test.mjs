// Render contract for the one-off service client provisioning Job (37-*) and its Make wrapper.
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

const JOB_FILE = 'deploy/k8s/base/37-oauth-register-service-client-job.yaml';
const JOB = 'oauth-register-service-client';
const SECRET = 'oauth-service-client-registration';
const DIST = 'dist/scripts/oauth-register-service-client.js';

// What the Make target applies: the versioned Job with the `register` image pinned
// (`kubectl set image --local ... register=<api image>`).
const render = (image) => {
  const [job, ...rest] = load(JOB_FILE);
  assert.equal(rest.length, 0, 'one document only');
  job.spec.template.spec.containers.find((container) => container.name === 'register').image = image;
  return job;
};

const recipe = () => {
  const makefile = read('Makefile');
  const start = makefile.indexOf(`\n${JOB}-job:`);
  assert.ok(start > 0, 'Make target exists');
  const end = makefile.indexOf('\n\n', start + 1);
  return makefile.slice(start, end);
};

test('the rendered Job runs the dist script once with the pinned image and envFrom only', () => {
  const image = 'ghcr.io/rhanka/sentropic-api@sha256:' + 'a'.repeat(64);
  const job = render(image);
  assert.equal(job.kind, 'Job');
  assert.equal(job.metadata.name, JOB);
  assert.equal(job.spec.backoffLimit, 0);
  const pod = job.spec.template.spec;
  assert.equal(job.spec.template.metadata.labels['app.kubernetes.io/component'], JOB);
  assert.equal(pod.restartPolicy, 'Never');
  assert.equal(pod.automountServiceAccountToken, false);
  assert.equal(pod.securityContext.seccompProfile.type, 'RuntimeDefault');
  assert.deepEqual(pod.containers.map((container) => container.name), ['register']);
  const [container] = pod.containers;
  assert.equal(container.image, image);
  assert.equal(container.workingDir, '/workspace/api');
  assert.deepEqual(container.command, ['node', DIST]);
  assert.equal(container.env, undefined, 'no literal env: secrets arrive through envFrom only');
  assert.equal(container.args, undefined, 'no CLI literals');
  assert.equal(container.securityContext.allowPrivilegeEscalation, false);
  assert.deepEqual(container.envFrom, [
    { configMapRef: { name: 'api' } },
    { secretRef: { name: 'sentropic-api' } },
    { secretRef: { name: SECRET } },
  ]);
});

test('the dist script is built into the api image and the Job stays out of kustomize', () => {
  assert.ok(fs.existsSync(path.join(root, 'api/src/scripts/oauth-register-service-client.ts')));
  const build = JSON.parse(read('api/package.json')).scripts.build;
  assert.match(build, /esbuild src\/scripts\/oauth-register-service-client\.ts .*--outfile=dist\/scripts\/oauth-register-service-client\.js/);
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

test('the Make wrapper guards the 0600 file, pins the image and cleans the Job and Secret on exit', () => {
  const body = recipe();
  assert.match(body, /stat -c %a "\$\$FILE"\)" in 600\|400\)/);
  assert.match(body, /grep -Evq '\^\(#\.\*\|\[\[:space:\]\]\*\|OAUTH_SERVICE_CLIENT_\[A-Z_\]\+=\.\*\)\$\$'/);
  assert.match(body, /get deployment\/api -o jsonpath=/);
  assert.ok(body.includes(`kubectl set image --local -f ${JOB_FILE} register="$$IMG" -o yaml`));
  assert.ok(body.includes(`create secret generic ${SECRET} --from-env-file="$$FILE" >/dev/null`));
  const trap = body.match(/trap '([^']*)' EXIT/);
  assert.ok(trap, 'cleanup trap on EXIT');
  assert.ok(trap[1].includes(`delete job/${JOB}`) && trap[1].includes(`delete secret/${SECRET}`));
  assert.ok(body.indexOf('trap ') < body.indexOf('create secret generic'), 'trap is armed before the Secret exists');
  assert.ok(!/cat |echo "\$\$\(cat/.test(body), 'the env file is never printed');
});
