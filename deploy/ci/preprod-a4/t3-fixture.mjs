import { readFileSync } from 'node:fs';
import { t3PriorityClass } from './ops.mjs';
export const RESTORE_NS = 'sentropic-restore-a4';
export const SINK_NS = 'sentropic-restore-sinks';
const names = new Set(['api', 'auth-idp', 'ui', 'postgres', 'pgbackup', 'sentropic-idp-identity-export',
  'sentropic', 'sentropic-api', 'sentropic-app', 'sentropic-a4-custody']);
const hosts = { 'sentropic.sent-tech.ca': 'app.restore-a4.test', 'auth.sent-tech.ca': 'auth.restore-a4.test' };
// PostgreSQL bytes of the prod tenant, by digest: the server image the live pod runs (its imageID, also
// the pin of overlays/prod) and the client image of the dump jobs (base/70-pgbackup-cronjob.yaml).
// Both are 17.11, which the target test-t3-sql proves on the bytes. The live StatefulSet still names
// the floating tag `postgres:17-alpine`: a fixture node pulled 17.12 through it, and a 17.12 dump carries
// column options that 17.11 refuses. The fixture therefore never keeps a postgres image off these pins.
export const PROD_POSTGRES_VERSION = '17.11';
export const PROD_POSTGRES_IMAGE = 'postgres@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b';
export const PROD_POSTGRES_TOOL_IMAGE = 'postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
const postgresPins = [PROD_POSTGRES_IMAGE, PROD_POSTGRES_TOOL_IMAGE].map(image => image.split('@')[1]);
// Pod labels selected by the platform NetworkPolicies of the isolated namespace, which the tenant
// cannot change: Traefik reaches `component: ui|auth-idp`, the backup storage egress is open to
// `component: backup-download`. They are added to the prod labels, which Services and the driver select.
const policyLabels = { 'Deployment/ui': 'ui', 'Deployment/auth-idp': 'auth-idp', 'CronJob/pgbackup': 'backup-download' };

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
    // Logical identity verification must match the immutable prod bundle contract.
    // Transport origins are isolated separately; these values are never HTTP destinations.
    if (clean.kind === 'ConfigMap') for (const key of ['WEBAUTHN_RP_ID','WEBAUTHN_ORIGIN']) {
      if (source.data?.[key] !== undefined) clean.data[key] = source.data[key];
    }
    if (clean.kind === 'CronJob') clean.spec.suspend = true;
    if (clean.kind === 'StatefulSet' && clean.metadata.name !== 'postgres') throw new Error('fixture_postgres_name');
    const template = clean.kind === 'CronJob' ? clean.spec.jobTemplate?.spec?.template : clean.spec?.template;
    const policyLabel = policyLabels[`${clean.kind}/${clean.metadata.name}`];
    if (policyLabel) template.metadata = { ...template.metadata, labels: { ...template.metadata?.labels, component: policyLabel } };
    // Same queue priority as the prod pods of the window (platform PriorityClass, no preemption).
    if (clean.kind === 'Deployment') template.spec.priorityClassName = t3PriorityClass;
    const containers = [...(template?.spec?.initContainers ?? []), ...(template?.spec?.containers ?? [])];
    if (clean.kind === 'StatefulSet') {
      const server = containers.find(container => container.name === 'postgres');
      if (!server) throw new Error('fixture_postgres_container');
      server.image = PROD_POSTGRES_IMAGE;
    }
    for (const { image } of containers) {
      if (/^(?:docker\.io\/(?:library\/)?)?postgres(?:[:@]|$)/.test(image ?? '') && !postgresPins.includes(image.split('@')[1])) {
        throw new Error('fixture_postgres_unpinned');
      }
    }
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
