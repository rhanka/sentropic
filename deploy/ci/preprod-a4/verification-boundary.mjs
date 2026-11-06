import { canonical, digest, namespace } from './guards.mjs';

export function assertTrafficRestriction(request, grant, k) {
  if (grant.authorizationRef !== request.authorizationRef || grant.operationId !== request.operationId
    || grant.candidateImage !== request.candidateImage || grant.candidateCommit !== request.candidateCommit
    || !/^rg\.fr-par\.scw\.cloud\/nc-reg\/sentropic-ui@sha256:[a-f0-9]{64}$/.test(grant.uiImage)
    || !/^[a-f0-9]{64}$/.test(grant.middlewareSpecSha256)
    || typeof grant.trafficRestrictionReceiptRef !== 'string' || !grant.trafficRestrictionReceiptRef.trim()
    || /placeholder|<|>|TODO|example|pending/i.test(grant.trafficRestrictionReceiptRef)) throw new Error('verification_grant_invalid');
  const middleware = JSON.parse(k(['get', 'middleware', 'a4-verification', '-o', 'json']));
  if (digest(canonical(middleware.spec)) !== grant.middlewareSpecSha256
    || Object.keys(middleware.spec).join(',') !== 'ipAllowList'
    || Object.keys(middleware.spec.ipAllowList).join(',') !== 'sourceRange'
    || !middleware.spec.ipAllowList.sourceRange?.length
    || !middleware.spec.ipAllowList.sourceRange.every(range => /\/(32|128)$/.test(range))) throw new Error('traffic_not_restricted');
  for (const [name, backend] of [['sentropic', 'ui'], ['auth-idp', 'auth-idp']]) {
    const ingress = JSON.parse(k(['get', 'ingress', name, '-o', 'json']));
    if (ingress.metadata.annotations?.['traefik.ingress.kubernetes.io/router.middlewares'] !== `${namespace}-a4-verification@kubernetescrd`
      || ingress.spec.rules.some(rule => rule.http.paths.some(path => path.backend.service.name !== backend))) {
      throw new Error('ingress_boundary_invalid');
    }
  }
}

export function assertVerificationBoundary(request, grant, k) {
  assertTrafficRestriction(request, grant, k);
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
