import { execFileSync } from 'node:child_process';

// Read-only: callers must finish this check before applying any workload changes.
export function assertIdpDeploymentReady(read) {
  const signing = read('secret', 'auth-idp-session-signing');
  const shared = read('secret', 'sentropic-api');
  const pvc = read('pvc', 'auth-idp-session-authority');
  const jwt = Buffer.from(signing.data?.JWT_SECRET ?? '', 'base64').toString('utf8');
  if (!/^[a-f0-9]{64}$/.test(jwt) || signing.data.JWT_SECRET === shared.data?.JWT_SECRET
    || !Buffer.from(shared.data?.OAUTH_SIGNING_KEK ?? '', 'base64').length
    || pvc.status?.phase !== 'Bound') throw new Error('idp_deploy_prerequisites_missing');
}

export function checkPreprodIdp() {
  try {
    assertIdpDeploymentReady((kind, name) => JSON.parse(execFileSync('kubectl',
      ['-n', 'sentropic-preprod', 'get', kind, name, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })));
  } catch {
    console.error('IdP deploy blocked: auth-idp-session-signing/JWT_SECRET, sentropic-api/OAUTH_SIGNING_KEK and a Bound auth-idp-session-authority PVC are required.');
    process.exitCode = 1;
  }
}
