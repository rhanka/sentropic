import { readFileSync } from 'node:fs';
export const image = 'docker.io/library/node@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68';
export const namespace = 'sentropic-artifact-builders';
export const name = 'gb4-isolation-probe';
export const writablePaths = ['/tmp', '/home/node/app/node_modules', '/home/node/app/.vite', '/home/node/.npm', '/dev/shm'];
const source = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
export const serverSource = () => source('checks.mjs').replace(/export /g, '') + '\n' + source('server.mjs').replace("import { selfTest } from './checks.mjs';", '') +
  '\nawait import(' + JSON.stringify('data:text/javascript;base64,' + Buffer.from(clientSource().replace('const host = process.argv[1];', "const host = '127.0.0.1';")).toString('base64')) + ');';
export const clientSource = () => source('client.mjs');
export const egressRule = {
  to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': namespace } },
    podSelector: { matchExpressions: [{ key: 'sentropic.dev/artifact-binding', operator: 'Exists' }] } }],
  ports: [{ protocol: 'TCP', port: 5173 }],
};
export function manifests(clusterTargets = []) {
  const labels = { 'sentropic.dev/artifact-binding': name };
  return [
    { apiVersion: 'v1', kind: 'Pod', metadata: { name, namespace, labels }, spec: {
      serviceAccountName: 'artifact-builder', automountServiceAccountToken: false,
      enableServiceLinks: false, restartPolicy: 'Never', activeDeadlineSeconds: 600,
      terminationGracePeriodSeconds: 5,
      securityContext: { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000, seccompProfile: { type: 'RuntimeDefault' } },
      containers: [{ name: 'probe', image, imagePullPolicy: 'IfNotPresent', workingDir: '/home/node/app',
        command: ['node', '--input-type=module', '-e', serverSource()],
        securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false, readOnlyRootFilesystem: true,
          capabilities: { drop: ['ALL'] }, seccompProfile: { type: 'RuntimeDefault' } },
        env: [{ name: 'GB4_CLUSTER_TARGETS', value: JSON.stringify(clusterTargets) },
          { name: 'HOME', value: '/home/node' }, { name: 'npm_config_cache', value: '/home/node/.npm' }],
        ports: [{ name: 'probe', containerPort: 5173, protocol: 'TCP' }],
        resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '500m', memory: '256Mi' } },
        readinessProbe: { httpGet: { path: '/healthz', port: 'probe' }, periodSeconds: 2 },
        volumeMounts: writablePaths.map((mountPath, i) => ({ name: `scratch-${i}`, mountPath })),
      }],
      volumes: writablePaths.map((_, i) => ({ name: `scratch-${i}`, emptyDir: { sizeLimit: '32Mi' } })),
    } },
    { apiVersion: 'v1', kind: 'Service', metadata: { name, namespace }, spec: {
      type: 'ClusterIP', selector: labels, ports: [{ name: 'probe', port: 5173, targetPort: 'probe', protocol: 'TCP' }],
    } },
  ];
}
export function clientPod(destination) {
  const pod = manifests()[0];
  pod.metadata.name = `${name}-denied`;
  pod.metadata.labels['sentropic.dev/artifact-binding'] = `${name}-denied`;
  const container = pod.spec.containers[0];
  container.command = ['node', '--input-type=module', '-e', clientSource(), destination];
  delete container.readinessProbe;
  delete container.ports;
  return pod;
}
