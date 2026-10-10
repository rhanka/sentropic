import assert from 'node:assert/strict';
export const postgresImage = 'postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
export const s5cmdImage = 'peakcom/s5cmd:v2.2.2@sha256:6e551552f7c6ffde461e3cfe6fab82cd3345b574bd256193194081fd9022da4a';
export const envValue = (container, name) => container.env.find(e => e.name === name)?.value;
export function checkBundle(objects, tier) {
  const prod = tier === 'prod', namespace = prod ? 'sentropic' : 'sentropic-preprod';
  const get = (kind, name) => { const hits = objects.filter(o => o.kind === kind && o.metadata.name === name); assert.equal(hits.length, 1, `${kind}/${name}`); return hits[0]; };
  for (const o of objects) assert.equal(o.metadata.namespace, namespace);
  assert(!objects.some(o => ['Secret', 'ValidatingAdmissionPolicy', 'ValidatingAdmissionPolicyBinding'].includes(o.kind)), 'bundle must not own secret values or admission policies');
  const component = prod ? 'idp-identity-export' : 'idp-identity-sync';
  const sa = prod ? 'sentropic-idp-export' : 'sentropic-idp-sync';
  assert.equal(get('ServiceAccount', sa).automountServiceAccountToken, false);
  const cj = get('CronJob', `sentropic-${component}`);
  assert.equal(cj.spec.schedule, '*/5 * * * *'); assert.equal(cj.spec.suspend, true);
  assert.equal(cj.spec.concurrencyPolicy, 'Forbid'); assert.equal(cj.spec.startingDeadlineSeconds, 600);
  const job = cj.spec.jobTemplate.spec, pod = job.template.spec;
  assert.equal(job.backoffLimit, 0); assert(job.activeDeadlineSeconds > 0); assert(job.ttlSecondsAfterFinished > 0);
  assert.equal(pod.serviceAccountName, sa); assert.equal(pod.automountServiceAccountToken, false);
  assert.equal(pod.enableServiceLinks, false); assert.equal(pod.restartPolicy, 'Never');
  assert.equal(pod.securityContext.runAsNonRoot, true); assert.equal(pod.securityContext.runAsUser, 70);
  assert.equal(pod.securityContext.fsGroup, 70); assert.equal(pod.securityContext.seccompProfile.type, 'RuntimeDefault');
  assert.equal(job.template.metadata.labels['app.kubernetes.io/component'], component);
  assert(!pod.hostNetwork && !pod.hostPID && !pod.hostIPC);
  const volumes = pod.volumes.filter(v => v.emptyDir);
  assert(volumes.length); for (const v of volumes) { assert.equal(v.emptyDir.medium, 'Memory'); assert(v.emptyDir.sizeLimit); }
  const containers = [...pod.initContainers, ...pod.containers];
  for (const c of containers) {
    assert([postgresImage, s5cmdImage].includes(c.image), 'image must match the approved pinned images');
    assert.equal(c.securityContext.allowPrivilegeEscalation, false); assert.deepEqual(c.securityContext.capabilities.drop, ['ALL']);
    for (const budget of ['requests', 'limits']) for (const resource of ['cpu', 'memory']) assert(c.resources[budget][resource]);
    assert(!c.envFrom, 'explicit env only');
    if (c.image === s5cmdImage) { assert(!c.command, 's5cmd must not assume a shell'); assert(c.args.includes('--endpoint-url')); }
    for (const e of c.env ?? []) if (/PASSWORD|SECRET|ACCESS_KEY/.test(e.name)) assert(e.valueFrom?.secretKeyRef, 'credential must use a Secret ref');
  }
  const secretNames = containers.flatMap(c => (c.env ?? []).flatMap(e => e.valueFrom?.secretKeyRef?.name ?? []));
  const expectedSecrets = prod ? ['sentropic-idp-identity-reader', 'sentropic-idp-relay-writer'] : ['sentropic-postgres', 'sentropic-pgbackup', 'sentropic-idp-relay-reader'];
  assert.deepEqual([...new Set(secretNames)].sort(), expectedSecrets.sort(), 'tier credential separation');
  const network = get('NetworkPolicy', prod ? 'allow-idp-export-to-postgres' : 'allow-idp-sync-to-postgres');
  assert.deepEqual(network.spec.podSelector.matchLabels, { 'app.kubernetes.io/name': 'sentropic', 'app.kubernetes.io/component': 'postgres' });
  assert.deepEqual(network.spec.policyTypes, ['Ingress']);
  assert.deepEqual(network.spec.ingress, [{ from: [{ podSelector: { matchLabels: { 'app.kubernetes.io/component': component } } }], ports: [{ protocol: 'TCP', port: 5432 }] }]);
  if (prod) {
    assert.deepEqual(pod.initContainers.map(c => c.name), ['export']); assert.deepEqual(pod.containers.map(c => c.name), ['upload']);
    assert(pod.initContainers[0].args.join(' ').includes('sha256sum users.csv webauthn.csv consents.csv clients.csv snapshot.csv > SHA256SUMS'));
    assert(!Object.hasOwn(get('ConfigMap', 'sentropic-idp-identity-export-sql').data, 'client-map.csv'));
    assert(pod.containers[0].args.includes('/work/*')); assert(pod.containers[0].args.includes('s3://$(S3_BUCKET)/idp-identity/latest/'));
    get('ConfigMap', 'sentropic-idp-identity-export-sql'); get('ConfigMap', 'sentropic-idp-reader-role-sql');
    assert.equal(get('ServiceAccount', 'sentropic-ci-trigger-idp-export').automountServiceAccountToken, false);
    const role = get('Role', 'sentropic-ci-trigger-idp-export');
    assert.deepEqual(role.rules, [
      { apiGroups: ['batch'], resources: ['cronjobs'], verbs: ['get', 'patch'], resourceNames: ['sentropic-idp-identity-export'] },
      { apiGroups: ['batch'], resources: ['jobs'], verbs: ['get', 'list', 'watch'] },
      { apiGroups: [''], resources: ['pods'], verbs: ['get', 'list'] },
    ]);
    const binding = get('RoleBinding', role.metadata.name);
    assert.deepEqual(binding.roleRef, { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: role.metadata.name });
    assert.deepEqual(binding.subjects, [{ kind: 'ServiceAccount', name: role.metadata.name, namespace }]);
  } else {
    assert(!objects.some(o => ['Role', 'RoleBinding'].includes(o.kind) || o.kind === 'ServiceAccount' && o.metadata.name !== sa), 'no preprod trigger delegation yet');
    assert.deepEqual(pod.initContainers.map(c => c.name), ['pre-sync-dump', 'pre-sync-upload', 'fetch-relay']);
    assert.deepEqual(pod.containers.map(c => c.name), ['import-preprod']);
    const importer = pod.containers[0];
    assert.equal(envValue(importer, 'DRY_RUN'), '1'); assert.equal(envValue(importer, 'ALLOWED_REKEY'), '');
    assert.equal(envValue(importer, 'MAX_SNAPSHOT_AGE_S'), '7200');
    assert.deepEqual(importer.command, ['sh', '/sql/import-preprod.sh']);
    assert(pod.initContainers[0].args[0].includes('pg_dump -Fc'));
    assert(pod.initContainers[0].args[0].includes('pre-idp-sync/%s.dump'));
    assert(pod.initContainers[1].args.includes('run')); assert(pod.initContainers[1].args.includes('/work/rb/upload.s5cmd'));
    assert(pod.initContainers[2].args.includes('s3://$(S3_BUCKET)/idp-identity/latest/*'));
    const cm = get('ConfigMap', 'sentropic-idp-identity-sync-sql');
    assert.equal(cm.data['client-map.csv'], 'prod_client_id,preprod_client_id\nradar-immobilier,radar-immobilier-preprod\n');
    for (const command of ['sha256sum -c SHA256SUMS', 'MAX_SNAPSHOT_AGE_S', 'expected_users', 'expected_webauthn', '/dev/termination-log']) assert(cm.data['import-preprod.sh'].includes(command));
  }
  return cj;
}
