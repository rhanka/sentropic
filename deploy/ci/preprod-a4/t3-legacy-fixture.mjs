// Legacy prod Deployments api, auth-idp and ui as read from the live namespace on 2026-11-14
// (read-only capture of rehearsal r8; no Secret value exists in a pod template). Live shape:
// API defaults, restartedAt annotation and images set out of band, while the last-applied
// annotation still carries the older applied template.
const probe = (path, initialDelaySeconds, periodSeconds, failureThreshold) => ({
  ...(failureThreshold ? { failureThreshold } : {}), httpGet: { path, port: 'http' }, initialDelaySeconds, periodSeconds });
const resources = (cpu, memory, cpuLimit, memoryLimit) => ({ limits: { cpu: cpuLimit, memory: memoryLimit }, requests: { cpu, memory } });
const envFrom = config => [{ configMapRef: { name: config } }, { secretRef: { name: 'sentropic-api' } }];
// The applied images named the retired registry, which check-image-registry refuses in tracked
// files. A placeholder host stands for it: apply reads only which fields that configuration owned.
const registry = 'retired-registry.invalid/nc-reg';
const applied = {
  api: { spec: { enableServiceLinks: false }, container: { envFrom: envFrom('api'), image: `${registry}/sentropic-api:main`,
    livenessProbe: probe('/api/v1/health', 20, 15), ports: [{ containerPort: 8787, name: 'http' }],
    readinessProbe: probe('/api/v1/health', 5, 10), resources: resources('100m', '256Mi', '500m', '512Mi'),
    startupProbe: probe('/api/v1/health', 10, 5, 60) },
  live: { image: 'ghcr.io/rhanka/sentropic-api@sha256:4bfa71ce7e231a9ed752e4aaceb23129a3399540af4720e32e76782c3f798c05',
    restartedAt: '2026-11-03T21:57:23Z' } },
  'auth-idp': { spec: {}, container: { command: ['node', 'apps/auth-idp/dist/index.js'], envFrom: envFrom('auth-idp'),
    image: `${registry}/sentropic-api:main`, livenessProbe: probe('/healthz', 20, 15),
    ports: [{ containerPort: 8787, name: 'http' }], readinessProbe: probe('/healthz', 5, 10),
    resources: resources('60m', '192Mi', '300m', '320Mi'), startupProbe: probe('/healthz', 10, 5, 60), workingDir: '/workspace' },
  live: { image: 'ghcr.io/rhanka/sentropic-api@sha256:4b78a02fc743ae85ce9f5819d5ebc6b49e02fca7b3161a87ea06afa401a3dc34',
    restartedAt: '2026-10-17T21:56:33-04:00' } },
  ui: { spec: {}, container: { image: `${registry}/sentropic-ui:main`, livenessProbe: probe('/', 20, 15),
    ports: [{ containerPort: 5173, name: 'http' }], readinessProbe: probe('/', 5, 10),
    resources: resources('30m', '64Mi', '100m', '128Mi') },
  live: { image: 'ghcr.io/rhanka/sentropic-ui@sha256:1f33dd0cde7733d2061f02ab1a5a14eb1a6276ce99001c697f5c697e2c0c9d4e',
    restartedAt: '2026-10-17T21:56:33-04:00' } },
};
const labels = name => ({ 'app.kubernetes.io/component': name, 'app.kubernetes.io/name': 'sentropic' });
const appliedTemplate = name => ({ metadata: { labels: labels(name) }, spec: { containers: [
  { ...applied[name].container, imagePullPolicy: 'Always', name }], ...applied[name].spec, serviceAccountName: 'sentropic-app' } });
// The defaults the API server stored on the live object.
function liveTemplate(name) {
  const template = appliedTemplate(name), container = template.spec.containers[0];
  for (const kind of ['livenessProbe', 'readinessProbe', 'startupProbe']) if (container[kind]) {
    container[kind] = { failureThreshold: 3, ...container[kind], httpGet: { ...container[kind].httpGet, scheme: 'HTTP' },
      successThreshold: 1, timeoutSeconds: 1 };
  }
  Object.assign(container, { image: applied[name].live.image, ports: container.ports.map(port => ({ ...port, protocol: 'TCP' })),
    terminationMessagePath: '/dev/termination-log', terminationMessagePolicy: 'File' });
  Object.assign(template.spec, { dnsPolicy: 'ClusterFirst', restartPolicy: 'Always', schedulerName: 'default-scheduler',
    securityContext: {}, serviceAccount: 'sentropic-app', terminationGracePeriodSeconds: 30 });
  template.metadata = { annotations: { 'kubectl.kubernetes.io/restartedAt': applied[name].live.restartedAt },
    creationTimestamp: null, labels: labels(name) };
  return template;
}
export function legacy() {
  return { apiVersion: 'v1', kind: 'List', items: Object.keys(applied).map(name => ({ apiVersion: 'apps/v1', kind: 'Deployment',
    metadata: { name, annotations: { 'kubectl.kubernetes.io/last-applied-configuration': JSON.stringify({
      apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name }, spec: { template: appliedTemplate(name) } }) } },
    spec: { replicas: 1, selector: { matchLabels: labels(name) }, strategy: { type: 'Recreate' }, template: liveTemplate(name) } })) };
}
if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(JSON.stringify(legacy()));
