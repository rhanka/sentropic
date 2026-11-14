import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// A4 operator tiers. Each owner-signed input names its tier in `format` and `namespace`, and every
// kubectl call runs in that namespace only. The operator names the tier explicitly (A4_TIER).
export const tiers = Object.freeze({
  preprod: Object.freeze({ tier: 'preprod', namespace: 'sentropic-preprod', origin: 'https://preprod.sentropic.sent-tech.ca' }),
  prod: Object.freeze({ tier: 'prod', namespace: 'sentropic', origin: 'https://sentropic.sent-tech.ca' }),
});
export function tierOf(env) {
  if (env.A4_TIER === 'restore') return { ...tiers.prod, destinationNamespace: 'sentropic-restore-a4',
    origin: 'https://app.restore-a4.test' };
  if (!Object.hasOwn(tiers, env.A4_TIER ?? '')) throw new Error('tier_invalid');
  return tiers[env.A4_TIER];
}
export const wiring = 'deploy/k8s/components/a4-wiring';
export const podName = 'sentropic-a4-custodian';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonical = value => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item)))
    : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, JSON.parse(canonical(item))])) : value);

export function kubectl(config, args, input, namespace) {
  if (namespace !== 'sentropic-restore-a4' && !Object.values(tiers).some(tier => tier.namespace === namespace)) throw new Error('namespace_invalid');
  const result = spawnSync('kubectl', ['--kubeconfig', config, '--namespace', namespace,
    '--request-timeout=60s', ...args], { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error('kubectl_failed');
  return result.stdout;
}
export function privateInput(path, max = 32768) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.size > max || (metadata.mode & 0o077)
    || metadata.uid !== process.getuid() || realpathSync(path) !== path) throw new Error('private_input_invalid');
  return readFileSync(path, 'utf8');
}
/** Prior approval binds the immutable annex without claiming any post-fence observation. */
export function assertAuthorization(authorization, tier) {
  if (authorization.format !== `${tier.tier}-a4-authorization/1` || authorization.namespace !== tier.namespace
    || typeof authorization.authorizationRef !== 'string' || !authorization.authorizationRef.trim()
    || authorization.authorizationRef.length > 512 || /placeholder|<|>|TODO|example|pending/i.test(authorization.authorizationRef)
    || !/^[a-z][a-z0-9-]{0,39}$/.test(authorization.operationId)
    || !/^[a-f0-9]{40}$/.test(authorization.candidateCommit) || authorization.candidateCommit === '0'.repeat(40)
    || !/^ghcr\.io\/rhanka\/sentropic-api@sha256:[a-f0-9]{64}$/.test(authorization.candidateImage)) {
    throw new Error('authorization_invalid');
  }
}
export function assertRequest(request, tier) {
  const refs = ['authorizationRef', 'writerFenceRef', 'rollbackCheckpointRef', 'rollbackLimitsRef',
    'sourceMetadataDispositionRef', 'remoteSnapshotRef'];
  if (request.format !== `${tier.tier}-a4-request/1` || request.namespace !== tier.namespace
    || !new RegExp(`^email-code-hmac:v1:${tier.tier}:[a-f0-9]{16}$`).test(request.emailCodeActiveKeyRef ?? '')
    || refs.some(name => typeof request[name] !== 'string' || !request[name].trim() || request[name].length > 512
      || /placeholder|<|>|TODO|example|pending/i.test(request[name]))
    || request.legacyWritersStopped !== true || request.remoteFileWriterStopped !== true
    || !/^[a-f0-9]{64}$/.test(request.remoteSnapshotDigest)
    || !/^[a-z][a-z0-9-]{0,39}$/.test(request.operationId)
    || !/^[a-f0-9]{40}$/.test(request.candidateCommit)
    || request.candidateCommit === '0'.repeat(40)
    || !/^ghcr\.io\/rhanka\/sentropic-api@sha256:[a-f0-9]{64}$/.test(request.candidateImage)
    || !/^[a-f0-9]{64}$/.test(request.backupTemplateSha256)) throw new Error('request_invalid');
}
export function assertFence(objects, pods, candidateImage) {
  const custodian = pods.find(pod => pod.metadata.name === podName);
  const custodyVolume = custodian?.spec.volumes?.find(volume => volume.persistentVolumeClaim?.claimName === 'sentropic-a4-custody');
  if (!custodian || custodian.status?.phase !== 'Running' || custodian.metadata.deletionTimestamp
    || custodian.spec.containers.length !== 1 || custodian.spec.containers[0].image !== candidateImage
    || !custodian.status.containerStatuses?.[0]?.ready
    || !custodian.status.containerStatuses[0].imageID?.endsWith(candidateImage.split('@')[1])
    || custodian.spec.automountServiceAccountToken !== false
    || !custodyVolume || custodyVolume.persistentVolumeClaim.readOnly
    || !custodian.spec.containers[0].volumeMounts?.some(mount => mount.name === custodyVolume.name
      && mount.mountPath === '/run/cm-cutover' && !mount.readOnly)) {
    throw new Error('custodian_invalid');
  }
  if (!objects.some(object => object.kind === 'Deployment' && object.metadata.name === 'api')) throw new Error('api_missing');
  for (const object of objects) {
    if (['Deployment', 'StatefulSet', 'DaemonSet'].includes(object.kind)) {
      if (object.kind === 'StatefulSet' && object.metadata.name === 'postgres') continue;
      if (object.kind === 'DaemonSet' || object.spec.replicas !== 0 || (object.status?.replicas ?? 0) !== 0) {
        throw new Error('writer_not_quiesced');
      }
    }
    if (object.kind === 'CronJob' && (object.spec.suspend !== true || object.status?.active?.length)) throw new Error('cron_not_quiesced');
    if (object.kind === 'Job' && (object.status?.active ?? 0) !== 0) throw new Error('job_active');
  }
  for (const pod of pods) {
    if (pod.metadata.name === podName || ['Succeeded', 'Failed'].includes(pod.status?.phase)) continue;
    if (pod.metadata.ownerReferences?.some(owner => owner.kind === 'StatefulSet' && owner.name === 'postgres')) continue;
    throw new Error('writer_pod_present');
  }
}
export function assertDigestOutput(output) {
  if (!output.trim() || !output.trim().split('\n').every(line => /^[A-Za-z][A-Za-z0-9]*=[a-f0-9]{64}$/.test(line))) {
    throw new Error('unsafe_worker_output');
  }
  return output;
}
