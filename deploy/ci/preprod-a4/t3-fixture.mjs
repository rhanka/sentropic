import { readFileSync } from 'node:fs';
export const RESTORE_NS = 'sentropic-restore-a4';
export const SINK_NS = 'sentropic-restore-sinks';
const names = new Set(['api', 'auth-idp', 'ui', 'postgres', 'pgbackup', 'sentropic-idp-identity-export',
  'sentropic', 'sentropic-api', 'sentropic-app', 'sentropic-a4-custody']);
const hosts = { 'sentropic.sent-tech.ca': 'app.restore-a4.test', 'auth.sent-tech.ca': 'auth.restore-a4.test' };

// Input: reviewed rendered/live object list, without Secret data. Output is inert JSON.
export function fixture(objects) {
  const output = [];
  for (const source of objects) {
    if (source.kind === 'Secret') throw new Error('fixture_secret_input_forbidden');
    if (!names.has(source.metadata?.name)
      || !['Deployment', 'StatefulSet', 'Service', 'ConfigMap', 'CronJob', 'Ingress',
        'PersistentVolumeClaim', 'ServiceAccount', 'Role', 'RoleBinding'].includes(source.kind)) continue;
    const object = structuredClone(source);
    object.metadata = { name: object.metadata.name, namespace: RESTORE_NS, labels: object.metadata.labels };
    delete object.status;
    const replace = value => {
      if (Array.isArray(value)) return value.map(replace);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,replace(v)]));
      if (typeof value === 'string') {
        for (const [from,to] of Object.entries(hosts)) value = value.replaceAll(from,to);
      }
      return value;
    };
    const clean = replace(object);
    if (clean.kind === 'CronJob') clean.spec.suspend = true;
    if (clean.kind === 'StatefulSet' && clean.metadata.name !== 'postgres') throw new Error('fixture_postgres_name');
    if (clean.kind === 'RoleBinding') for (const subject of clean.subjects ?? []) {
      if (subject.kind === 'ServiceAccount') subject.namespace = RESTORE_NS;
    }
    if (clean.kind === 'ConfigMap' && ['api','auth-idp'].includes(clean.metadata.name)) {
      Object.assign(clean.data, { SCW_TEM_API_BASE_URL: `http://tem.${SINK_NS}.svc.cluster.local:8080`,
        SMTP_HOST: `mail.${SINK_NS}.svc.cluster.local`, SMTP_PORT: '1025',
        ARTIFACT_BUILD_BACKEND: 'disabled', ARTIFACT_LIVE_ENABLED: 'false' });
    }
    output.push(clean);
  }
  for (const [kind,name] of [['Deployment','api'],['Deployment','auth-idp'],['Deployment','ui'],['StatefulSet','postgres']]) {
    if (!output.some(o => o.kind === kind && o.metadata.name === name)) throw new Error('fixture_inventory_incomplete');
  }
  output.push({ apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy',
    metadata: { name: 'isolated-restore', namespace: RESTORE_NS }, spec: {
      podSelector: {}, policyTypes: ['Egress'], egress: [
        { to: [RESTORE_NS,SINK_NS].map(name => ({ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': name } } })) },
        { to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } } }],
          ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }] },
      ] } });
  return { apiVersion: 'v1', kind: 'List', items: output };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.stdout.write(JSON.stringify(fixture(JSON.parse(readFileSync(process.argv[2], 'utf8')).items))); }
  catch { console.error('fixture_refused'); process.exitCode = 1; }
}
