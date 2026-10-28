import { execFileSync } from 'node:child_process';

// Read-only: callers must finish this check before applying any workload changes.
export function assertIdpDeploymentReady(read) {
  const signing = read('secret', 'auth-idp-session-signing');
  const shared = read('secret', 'sentropic-api');
  const pvc = read('pvc', 'auth-idp-session-authority');
  const config = read('configmap', 'auth-idp');
  const sharedValue = name => Buffer.from(shared.data?.[name] ?? '', 'base64').toString('utf8');
  const revocationKeys = ['REMOTE_ACTION_REVOCATION_ISSUER', 'REMOTE_ACTION_REVOCATION_CLIENT_ID',
    'REMOTE_ACTION_REVOCATION_CLIENT_SECRET', 'REMOTE_ACTION_REVOCATION_RESOURCE'];
  if (revocationKeys.some(name => !sharedValue(name).trim())) throw new Error('idp_revocation_configuration_missing');
  const issuer = new URL(sharedValue('REMOTE_ACTION_REVOCATION_ISSUER'));
  const expectedIssuer = sharedValue('OAUTH_ISSUER_URL') || config.data?.OAUTH_ISSUER_URL;
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash
    || issuer.pathname !== '/' || issuer.origin !== expectedIssuer?.replace(/\/$/, ''))
    throw new Error('idp_revocation_configuration_invalid');
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
    console.error('IdP deploy blocked: require auth-idp-session-signing/JWT_SECRET, sentropic-api/OAUTH_SIGNING_KEK + REMOTE_ACTION_REVOCATION_* (matched HTTPS issuer), and a Bound auth-idp-session-authority PVC.');
    process.exitCode = 1;
  }
}
