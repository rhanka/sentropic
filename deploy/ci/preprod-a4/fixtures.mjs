export const sha = 'a'.repeat(64), commit = 'b'.repeat(40);
export const image = `rg.fr-par.scw.cloud/nc-reg/sentropic-api@sha256:${sha}`;
export const cron = { metadata: { namespace: 'sentropic-preprod' }, spec: { suspend: true,
  jobTemplate: { spec: { backoffLimit: 2, template: { spec: { restartPolicy: 'OnFailure',
    initContainers: [{ name: 'dump', image: 'tenant-postgres-pinned' }],
    containers: [{ name: 'upload', image: 'tenant-s5cmd-pinned' }] } } } } } };
export const objects = [
  { kind: 'Deployment', metadata: { name: 'api' }, spec: { replicas: 0 }, status: { replicas: 0 } },
  { kind: 'CronJob', metadata: { name: 'pgbackup' }, spec: { suspend: true } },
  { kind: 'StatefulSet', metadata: { name: 'postgres' }, spec: { replicas: 1 } },
];
export const pods = [{ metadata: { name: 'sentropic-a4-custodian' },
  spec: { automountServiceAccountToken: false, containers: [{ image,
    volumeMounts: [{ name: 'cm-cutover', mountPath: '/run/cm-cutover', readOnly: false }] }],
  volumes: [{ name: 'cm-cutover', persistentVolumeClaim: { claimName: 'sentropic-a4-custody' } }] },
  status: { phase: 'Running', containerStatuses: [{ ready: true, imageID: `containerd://${image}` }] } }];

export function fixture(overrides = {}) {
  const calls = [];
  const data = { objects: structuredClone(objects), pods: structuredClone(pods), cron: structuredClone(cron), ...overrides };
  return { calls, data, call(_config, args, input) {
    calls.push({ args, input });
    if (args.join(' ').startsWith('get cronjob pgbackup')) return JSON.stringify(data.cron);
    if (args[0] === 'get' && args[1].includes('deployments,')) return JSON.stringify({ items: data.objects });
    if (args[0] === 'get' && args[1] === 'pods') return JSON.stringify({ items: args.includes('-l')
      ? [{ metadata: { name: 'backup-success' }, status: { phase: 'Succeeded' } }] : data.pods });
    if (args[0] === 'exec') return data.workerOutput ?? `checkpointSha256=${sha}\n`;
    if (args[0] === 'logs') return 'dumping app DB at 20261106T150000Z\nPRIVATE-LOG-SENTINEL\n';
    if (['create', 'wait'].includes(args[0])) return 'suppressed Kubernetes output';
    throw new Error('unexpected_fake_call');
  } };
}
