import { pathToFileURL } from 'node:url';
import { assertDigestOutput, assertFence, assertRequest, canonical, digest,
  kubectl, podName, privateInput, tierOf } from './guards.mjs';

export function run(env = process.env, call = kubectl, read = privateInput) {
  const phase = env.A4_PHASE ?? 'checkpoint', dryRun = env.A4_DRY_RUN ?? '1', tier = tierOf(env);
  const namespace = tier.destinationNamespace ?? tier.namespace;
  if (!['inspect', 'snapshot', 'checkpoint'].includes(phase) || !['0', '1'].includes(dryRun)
    || !env.A4_KUBECONFIG_FILE) throw new Error('arguments_invalid');
  read(env.A4_KUBECONFIG_FILE); // Owner-only file; contents are never forwarded or printed.
  const k = (args, input) => call(env.A4_KUBECONFIG_FILE, args, input, namespace);
  const json = args => JSON.parse(k(args));
  const cron = json(['get', 'cronjob', 'pgbackup', '-o', 'json']);
  if (cron.metadata.namespace !== namespace || !cron.spec.jobTemplate.spec?.template?.spec) throw new Error('backup_path_invalid');
  const backupTemplateSha256 = digest(canonical(cron.spec.jobTemplate.spec));
  if (phase === 'inspect') return `backupTemplateSha256=${backupTemplateSha256}\n`;
  const requestBytes = read(env.A4_REQUEST_FILE), request = JSON.parse(requestBytes);
  assertRequest(request, tier);
  if (request.backupTemplateSha256 !== backupTemplateSha256) throw new Error('backup_template_changed');
  const fence = () => assertFence(json(['get', 'deployments,statefulsets,daemonsets,cronjobs,jobs', '-o', 'json']).items,
    json(['get', 'pods', '-o', 'json']).items, request.candidateImage);
  const worker = (workerPhase, workerDryRun, backupKey, stateSha256) => assertDigestOutput(k(['exec', '-i', podName, '-c', 'custodian', '--',
    'node', '/run/cm-runtime/launch.mjs', '--cm-preprod-checkpoint'], JSON.stringify({
    phase: workerPhase, dryRun: workerDryRun, requestSha256: digest(requestBytes),
    ...(backupKey ? { backupKey, stateSha256 } : {}) })));
  fence();
  // Each worker invocation loads the whole API bundle. The checkpoint worker validates custody,
  // state, backup and rehearsal before its only write (a custody file), and no Kubernetes write
  // follows it: one invocation, dry or real, is the complete bundle-side preflight.
  if (phase === 'checkpoint') {
    const checkpoint = worker('checkpoint', dryRun === '1');
    fence();
    return checkpoint;
  }
  // Snapshot: the bundle-side preflight precedes the only Kubernetes write (the backup Job) and
  // yields the pre-backup state the second invocation must find unchanged.
  const preflight = worker('snapshot', true);
  if (dryRun === '1') { fence(); return preflight; }
  const stateSha256 = digest(canonical(Object.fromEntries(preflight.trim().split('\n').map(line => line.split('=')))));
  const name = `pgbackup-a4-${request.operationId}`;
  // Clone the reviewed tenant template exactly. No custom dump/upload path or credential.
  k(['create', '-f', '-'], JSON.stringify({ apiVersion: 'batch/v1', kind: 'Job',
    metadata: { name, namespace }, spec: cron.spec.jobTemplate.spec }));
  k(['wait', '--for=condition=complete', '--timeout=180s', `job/${name}`]);
  const pods = json(['get', 'pods', '-l', `batch.kubernetes.io/job-name=${name}`, '-o', 'json']).items;
  const succeeded = pods.filter(pod => pod.status?.phase === 'Succeeded');
  if (succeeded.length !== 1) throw new Error('backup_job_invalid');
  const log = k(['logs', succeeded[0].metadata.name, '-c', 'dump']);
  const timestamps = [...log.matchAll(/^dumping app DB at ([0-9]{8}T[0-9]{6}Z)\s*$/gm)];
  if (timestamps.length !== 1) throw new Error('backup_key_unresolved');
  fence();
  const output = worker('snapshot', false, `pg/${timestamps[0][1]}.sql.gz`, stateSha256);
  fence();
  return output;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { process.stdout.write(run()); }
  catch {
    process.stderr.write(`failureSha256=${digest('preprod-a4-operator-failed')}\n`);
    process.exitCode = 1;
  }
}
