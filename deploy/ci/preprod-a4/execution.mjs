import { pathToFileURL } from 'node:url';
import { assertRequest, canonical, digest, kubectl, namespace, privateInput } from './guards.mjs';
import { assertTrafficRestriction } from './verification-boundary.mjs';

export function executionGrant(env, request, read = privateInput) {
  const bytes = read(env.A4_EXECUTION_FILE);
  if (!/^[a-f0-9]{64}$/.test(env.A4_EXECUTION_SHA256 ?? '') || digest(bytes) !== env.A4_EXECUTION_SHA256) throw new Error('annex_changed');
  const grant = JSON.parse(bytes);
  if (grant.format !== 'preprod-a4-execution/1' || grant.namespace !== namespace
    || ['authorizationRef', 'operationId', 'candidateCommit', 'candidateImage'].some(name => grant[name] !== request[name])) {
    throw new Error('annex_binding_invalid');
  }
  return grant;
}

/** Execute only the exact command vectors recorded in the owner's immutable annex. */
export function execute(env = process.env, call = kubectl, read = privateInput) {
  read(env.A4_KUBECONFIG_FILE);
  const request = JSON.parse(read(env.A4_REQUEST_FILE)); assertRequest(request);
  const grant = executionGrant(env, request, read), action = env.A4_ACTION;
  if (!['fence', 'delete-custodian', 'start-api', 'start-ui', 'start-idp', 'refence', 'resume', 'restrict', 'open-traffic'].includes(action)
    || !['0', '1'].includes(env.A4_DRY_RUN ?? '1')) throw new Error('action_invalid');
  const k = (args, input) => call(env.A4_KUBECONFIG_FILE, args, input);
  const commands = grant.actions?.[action];
  if (!Array.isArray(commands) || !commands.length) throw new Error('action_not_authorized');
  const resource = '(?:deployment|statefulset)/[a-z][a-z0-9-]*';
  for (const args of commands) {
    if (!Array.isArray(args) || !args.every(value => typeof value === 'string' && !/[\r\n]/.test(value))) throw new Error('command_invalid');
    const command = args.join(' ');
    const allowed = [new RegExp(`^scale ${resource} --replicas=[0-9]{1,2}$`),
      new RegExp(`^rollout status ${resource} --timeout=180s$`),
      /^patch cronjob [a-z][a-z0-9-]* --type=merge -p \{"spec":\{"suspend":(?:true|false)\}\}$/,
      /^delete pod sentropic-a4-custodian --wait=true --timeout=180s$/,
      /^annotate ingress (?:sentropic|auth-idp) traefik\.ingress\.kubernetes\.io\/router\.middlewares(?:=sentropic-preprod-a4-verification@kubernetescrd --overwrite|-)$/];
    const image = args[2] === 'deployment/ui' ? grant.uiImage : request.candidateImage;
    const setImage = args.length === 4 && args[0] === 'set' && args[1] === 'image'
      && ['api', 'ui', 'auth-idp'].some(name => args[2] === `deployment/${name}` && args[3] === `${name}=${image}`);
    if (!allowed.some(pattern => pattern.test(command)) && !setImage) throw new Error('command_not_allowed');
    if (/statefulset\/postgres(?: |$)|cronjob sentropic-idp-identity-sync .*false/.test(command)) throw new Error('protected_controller');
  }
  if (commands.some(args => args[0] === 'scale' && ['deployment/ui', 'deployment/auth-idp'].includes(args[1])
    && args[2] !== '--replicas=0')) assertTrafficRestriction(request, grant, k);
  // Network boundary is tenant-approved, namespace-scoped and attached before either proxy starts.
  if (action === 'restrict') {
    const spec = grant.middlewareSpec;
    if (!spec || digest(canonical(spec)) !== grant.middlewareSpecSha256
      || Object.keys(spec).join(',') !== 'ipAllowList' || Object.keys(spec.ipAllowList).join(',') !== 'sourceRange'
      || !spec.ipAllowList.sourceRange?.length || !spec.ipAllowList.sourceRange.every(range => /\/(32|128)$/.test(range))) {
      throw new Error('traffic_boundary_invalid');
    }
    if (env.A4_DRY_RUN === '0') k(['create', '-f', '-'], JSON.stringify({ apiVersion: 'traefik.io/v1alpha1',
      kind: 'Middleware', metadata: { name: 'a4-verification', namespace }, spec }));
  }
  if (env.A4_DRY_RUN === '0') for (const args of commands) k(args);
  return `executionSha256=${digest(canonical({ annex: env.A4_EXECUTION_SHA256, action, commands }))}\n`;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { process.stdout.write(execute()); }
  catch { process.stderr.write(`failureSha256=${digest('preprod-a4-execution-failed')}\n`); process.exitCode = 1; }
}
