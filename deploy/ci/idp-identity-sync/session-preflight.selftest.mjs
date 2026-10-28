import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertIdpDeploymentReady } from './session-preflight.mjs';

export function sessionPreflightTests(check, load) {
  const secret = value => Buffer.from(value).toString('base64');
  const ready = () => ({ 'auth-idp-session-signing': { data: { JWT_SECRET: secret('a'.repeat(64)) } },
    'sentropic-api': { data: { JWT_SECRET: secret('b'.repeat(64)), OAUTH_SIGNING_KEK: secret('shared-kek') } },
    'auth-idp-session-authority': { status: { phase: 'Bound' } } });
  check('IdP preflight accepts provisioned prerequisites using reads only', () => {
    const calls = [];
    assertIdpDeploymentReady((kind, name) => { calls.push([kind, name]); return ready()[name]; });
    assert.deepEqual(calls, [['secret', 'auth-idp-session-signing'], ['secret', 'sentropic-api'], ['pvc', 'auth-idp-session-authority']]);
  });
  for (const missing of Object.keys(ready())) check(`IdP preflight blocks missing ${missing}`, () => {
    assert.throws(() => assertIdpDeploymentReady((kind, name) => {
      if (name === missing) throw new Error('not found');
      return ready()[name];
    }));
  });
  for (const mutation of [r => { r['auth-idp-session-signing'].data = {}; },
    r => { r['auth-idp-session-signing'].data.JWT_SECRET = secret('short'); },
    r => { r['sentropic-api'].data.OAUTH_SIGNING_KEK = ''; },
    r => { r['sentropic-api'].data.JWT_SECRET = r['auth-idp-session-signing'].data.JWT_SECRET; },
    r => { r['auth-idp-session-authority'].status.phase = 'Pending'; }]) {
    check('IdP preflight blocks invalid or unavailable prerequisites', () => {
      const resources = ready(); mutation(resources);
      assert.throws(() => assertIdpDeploymentReady((kind, name) => resources[name]));
    });
  }
  check('CD cannot apply before the read-only IdP preflight succeeds', () => {
    const [workflow] = load('.github/workflows/ci.yml');
    const steps = workflow.jobs['deploy-preprod'].steps;
    const deploy = steps.find(s => s.run?.includes('make k8s-deploy-preprod KUBECONFIG='));
    assert.match(deploy.run, /^set -eu\nnode .*checkPreprodIdp\(\).*\nmake k8s-deploy-preprod/m);
    assert.equal(steps.filter(s => s.run?.includes('k8s-deploy-preprod KUBECONFIG=')).length, 1);
  });
  check('session provisioning uses the governed environment and server-side apply', () => {
    const [workflow] = load('.github/workflows/idp-session-secret.yml');
    const job = workflow.jobs['materialize-preprod-session-secret'];
    assert.equal(job.environment, 'sentropic-idp-run');
    assert.equal(job.if, "github.ref == 'refs/heads/main'");
    const step = job.steps.find(s => s.env?.AUTH_IDP_SESSION_JWT_SECRET);
    assert.equal(step.env.AUTH_IDP_SESSION_JWT_SECRET, '${{ secrets.AUTH_IDP_SESSION_JWT_SECRET }}');
    assert.match(step.run, /'apply', '--server-side', '--field-manager=idp-session-secret'/);
    assert.doesNotMatch(readFileSync('.github/workflows/idp-session-secret.yml', 'utf8'), /randomBytes|generateKey/);
  });
}
