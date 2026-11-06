import { pathToFileURL } from 'node:url';
import { assertDigestOutput, assertRequest, canonical, digest, kubectl, namespace, podName, privateInput } from './guards.mjs';

export function ops(env = process.env, call = kubectl, read = privateInput) {
  if (!['wire', 'budgets', 'custodian', 'stage'].includes(env.A4_OPERATION)
    || !['0', '1'].includes(env.A4_DRY_RUN ?? '1')) throw new Error('arguments_invalid');
  read(env.A4_KUBECONFIG_FILE);
  const requestBytes = read(env.A4_REQUEST_FILE), request = JSON.parse(requestBytes);
  assertRequest(request);
  const k = (args, input) => call(env.A4_KUBECONFIG_FILE, args, input);
  if (env.A4_OPERATION === 'budgets') {
    const bytes = read(env.A4_BUDGETS_FILE), budgets = JSON.parse(bytes);
    const names = ['reservation', 'deletion', 'diagnostic', 'read', 'workspace', 'replicaExport', 'replicaValidation', 'replicaSync'];
    if (Object.keys(budgets).length !== 9 || typeof budgets.qualificationReceiptRef !== 'string'
      || !budgets.qualificationReceiptRef.trim() || /pending|placeholder|TODO|example|<|>/i.test(budgets.qualificationReceiptRef)) {
      throw new Error('budgets_unqualified');
    }
    for (const name of names) {
      const entry = budgets[name];
      if (!entry || Object.keys(entry).sort().join(',') !== 'deadlineMs,maxAttempts'
        || !Number.isSafeInteger(entry.deadlineMs) || entry.deadlineMs < 1 || entry.deadlineMs > 600_000
        || ![1, 2, 3].includes(entry.maxAttempts)) throw new Error('budgets_invalid');
    }
    const secret = { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'sentropic-identity-budgets', namespace },
      type: 'Opaque', data: { CM_IDENTITY_DELETION_BUDGETS_JSON: Buffer.from(bytes).toString('base64') } };
    if (env.A4_DRY_RUN === '0') k(['create', '-f', '-'], JSON.stringify(secret));
    return `budgetsSha256=${digest(bytes)}\n`;
  }
  if (env.A4_OPERATION === 'wire') {
    for (const name of ['api', 'auth-idp']) {
      const deployment = JSON.parse(k(['get', 'deployment', name, '-o', 'json']));
      if (deployment.spec.replicas !== 0 || (deployment.status?.replicas ?? 0) !== 0) throw new Error('consumer_not_quiesced');
    }
    const runtime = k(['kustomize', 'deploy/k8s/overlays/preprod/a4-runtime']);
    if (env.A4_DRY_RUN === '0') {
      k(['apply', '-f', 'deploy/ci/preprod-a4/custody-pvc.yaml']);
      k(['apply', '-f', '-'], runtime);
      k(['patch', 'configmap', 'api', '--type=merge', '--patch-file=deploy/k8s/overlays/preprod-a4/patch-api-config.yaml']);
      k(['patch', 'deployment', 'api', '--type=strategic', '--patch-file=deploy/k8s/overlays/preprod-a4/patch-api-a4.yaml']);
      k(['set', 'image', 'deployment/api', `api=${request.candidateImage}`]);
      k(['patch', 'configmap', 'auth-idp', '--type=merge', '--patch-file=deploy/k8s/overlays/preprod-a4/patch-auth-idp-config.yaml']);
      k(['patch', 'deployment', 'auth-idp', '--type=strategic', '--patch-file=deploy/k8s/overlays/preprod-a4/patch-auth-idp-a4.yaml']);
      k(['set', 'image', 'deployment/auth-idp', `auth-idp=${request.candidateImage}`]);
    }
    return `runtimeManifestSha256=${digest(runtime)}\n`;
  }
  if (env.A4_OPERATION === 'custodian') {
    const api = JSON.parse(k(['get', 'deployment', 'api', '-o', 'json']));
    if (api.spec.replicas !== 0 || (api.status?.replicas ?? 0) !== 0) throw new Error('api_not_quiesced');
    const spec = structuredClone(api.spec.template.spec);
    const container = spec.containers.find(container => container.name === 'api');
    if (!container || container.command?.join(' ') !== 'node /run/cm-runtime/launch.mjs'
      || !spec.volumes?.some(volume => volume.configMap?.name === 'sentropic-a4-runtime')
      || !spec.volumes.some(volume => volume.persistentVolumeClaim?.claimName === 'sentropic-a4-custody')) {
      throw new Error('overlay_not_installed');
    }
    container.name = 'custodian'; container.image = request.candidateImage;
    container.command = ['node', '/run/cm-runtime/launch.mjs', '--custodian'];
    container.env = [...container.env, { name: 'A4_CANDIDATE_COMMIT', value: request.candidateCommit }];
    container.envFrom.push({ secretRef: { name: 'sentropic-pgbackup' } });
    for (const property of ['ports', 'readinessProbe', 'startupProbe', 'livenessProbe']) delete container[property];
    const volume = spec.volumes.find(volume => volume.persistentVolumeClaim?.claimName === 'sentropic-a4-custody');
    volume.persistentVolumeClaim.readOnly = false;
    container.volumeMounts.find(mount => mount.name === volume.name).readOnly = false;
    spec.containers = [container]; spec.initContainers = []; spec.restartPolicy = 'Never';
    spec.automountServiceAccountToken = false;
    container.securityContext = { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] }, readOnlyRootFilesystem: true };
    const pod = { apiVersion: 'v1', kind: 'Pod', metadata: { name: podName, namespace,
      labels: { 'app.kubernetes.io/name': 'sentropic', 'app.kubernetes.io/component': 'pgbackup' } }, spec };
    if (env.A4_DRY_RUN === '0') {
      k(['create', '-f', '-'], JSON.stringify(pod));
      k(['wait', '--for=condition=Ready', '--timeout=180s', `pod/${podName}`]);
    }
    return `custodianManifestSha256=${digest(canonical(pod))}\n`;
  }
  if (!['inputs', 'rehearsal'].includes(env.A4_STAGE)) throw new Error('stage_invalid');
  const files = env.A4_STAGE === 'rehearsal'
    ? { 'rehearsal.json': read(env.A4_REHEARSAL_FILE) }
    : { 'request.json': requestBytes, 'remote.json': read(env.A4_REMOTE_FILE, 64 * 1024 * 1024) };
  if (files['remote.json'] && digest(files['remote.json']) !== request.remoteSnapshotDigest) throw new Error('remote_digest_mismatch');
  if (env.A4_DRY_RUN === '0') return assertDigestOutput(k(['exec', '-i', podName, '-c', 'custodian', '--',
    'node', '/run/cm-runtime/stage.mjs'], JSON.stringify(files)));
  return Object.entries(files).map(([name, bytes]) => `${name.replace('.json', '')}Sha256=${digest(bytes)}\n`).join('');
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { process.stdout.write(ops()); }
  catch { process.stderr.write(`failureSha256=${digest('preprod-a4-custody-failed')}\n`); process.exitCode = 1; }
}
