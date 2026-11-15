import { createHash, randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { canonical, digest, privateInput } from './guards.mjs';

// The load balancer in front of Traefik rewrites every client address to a node address
// (externalTrafficPolicy Cluster, no proxy protocol), so a source-range rule cannot tell the operator
// from anyone else. The boundary is a credential: Traefik basicAuth, whose user list is a Kubernetes
// Secret named in the annex. removeHeader keeps the credential away from the workloads.
export const VERIFICATION_SECRET = 'a4-verification-auth';
export const verificationSpecValid = spec => Object.keys(spec ?? {}).join(',') === 'basicAuth'
  && Object.keys(spec.basicAuth ?? {}).sort().join(',') === 'removeHeader,secret'
  && spec.basicAuth.secret === VERIFICATION_SECRET && spec.basicAuth.removeHeader === true;

// One private `user:password` line. The cluster only holds its SHA-1 verifier (htpasswd form); the
// value is never printed, logged or passed on a command line.
export function verificationCredential(path, read = privateInput) {
  let line;
  try { line = read(path).trim(); } catch { throw new Error('verification_credential_missing'); }
  const match = /^([A-Za-z0-9_-]{1,64}):([\x21-\x7e]{32,1024})$/.exec(line);
  if (!match) throw new Error('verification_credential_invalid');
  return { header: `Basic ${Buffer.from(line).toString('base64')}`,
    users: `${match[1]}:{SHA}${createHash('sha1').update(match[2]).digest('base64')}\n` };
}

// Traefik must read exactly the verifier of the local credential: one key, one line.
export function assertVerificationSecret(secret, users) {
  if (secret?.type !== 'Opaque' || Object.keys(secret.data ?? {}).join(',') !== 'users'
    || Buffer.from(String(secret.data.users), 'base64').toString().trim() !== users.trim()) {
    throw new Error('verification_secret_mismatch');
  }
}

// Explicit operator action (t3-maintenance verification-secret): writes the private credential when
// the file does not exist yet, then replaces the Secret with its verifier, sent on stdin.
export function provisionVerification(path, namespace, call, read = privateInput) {
  if (call(['get', 'middleware', 'a4-verification', '--ignore-not-found=true', '-o', 'name']).trim()) {
    throw new Error('verification_boundary_active');
  }
  if (!existsSync(path)) {
    writeFileSync(path, `t3-verify:${randomBytes(32).toString('base64url')}\n`, { mode: 0o600, flag: 'wx' });
  }
  const { users } = verificationCredential(path, read);
  call(['delete', 'secret', VERIFICATION_SECRET, '--ignore-not-found=true']);
  call(['create', '-f', '-'], JSON.stringify({ apiVersion: 'v1', kind: 'Secret', type: 'Opaque',
    metadata: { name: VERIFICATION_SECRET, namespace }, data: { users: Buffer.from(users).toString('base64') } }));
  return { verificationSecret: VERIFICATION_SECRET };
}

export function assertTrafficRestriction(request, grant, k, namespace) {
  if (grant.authorizationRef !== request.authorizationRef || grant.operationId !== request.operationId
    || grant.candidateImage !== request.candidateImage || grant.candidateCommit !== request.candidateCommit
    || !/^ghcr\.io\/rhanka\/sentropic-ui@sha256:[a-f0-9]{64}$/.test(grant.uiImage)
    || !/^[a-f0-9]{64}$/.test(grant.middlewareSpecSha256)
    || typeof grant.trafficRestrictionReceiptRef !== 'string' || !grant.trafficRestrictionReceiptRef.trim()
    || /placeholder|<|>|TODO|example|pending/i.test(grant.trafficRestrictionReceiptRef)) throw new Error('verification_grant_invalid');
  const middleware = JSON.parse(k(['get', 'middleware', 'a4-verification', '-o', 'json']));
  if (digest(canonical(middleware.spec)) !== grant.middlewareSpecSha256
    || !verificationSpecValid(middleware.spec)) throw new Error('traffic_not_restricted');
  for (const [name, backend] of [['sentropic', 'ui'], ['auth-idp', 'auth-idp']]) {
    const ingress = JSON.parse(k(['get', 'ingress', name, '-o', 'json']));
    if (ingress.metadata.annotations?.['traefik.ingress.kubernetes.io/router.middlewares'] !== `${namespace}-a4-verification@kubernetescrd`
      || ingress.spec.rules.some(rule => rule.http.paths.some(path => path.backend.service.name !== backend))) {
      throw new Error('ingress_boundary_invalid');
    }
  }
}

export function assertVerificationBoundary(request, grant, k, namespace) {
  assertTrafficRestriction(request, grant, k, namespace);
  const objects = JSON.parse(k(['get', 'deployments,statefulsets,daemonsets,cronjobs,jobs', '-o', 'json'])).items;
  for (const object of objects) {
    if (object.kind === 'StatefulSet' && object.metadata.name === 'postgres') continue;
    if (object.kind === 'CronJob' && object.spec.suspend === true && !object.status?.active?.length) continue;
    if (object.kind === 'Job' && !(object.status?.active ?? 0)) continue;
    if (object.kind === 'Deployment' && ['api', 'ui', 'auth-idp'].includes(object.metadata.name)) {
      const name = object.metadata.name, spec = object.spec;
      if (spec.replicas === 1 && spec.template.spec.containers.find(container => container.name === name)?.image
        === (name === 'ui' ? grant.uiImage : request.candidateImage)) continue;
      if (name === 'auth-idp' && spec.replicas === 0 && !(object.status?.replicas ?? 0)) continue;
      throw new Error('verification_release_invalid');
    }
    if (['Deployment', 'StatefulSet'].includes(object.kind) && object.spec.replicas === 0 && !(object.status?.replicas ?? 0)) continue;
    throw new Error('writer_not_fenced');
  }
  const ui = JSON.parse(k(['get', 'deployment', 'ui', '-o', 'json']));
  if (ui.spec.replicas !== 1 || ui.status?.availableReplicas !== 1 || ui.status.updatedReplicas !== 1
    || ui.status.observedGeneration !== ui.metadata.generation
    || ui.spec.template.spec.containers.find(container => container.name === 'ui')?.image !== grant.uiImage) throw new Error('ui_not_ready');
}
