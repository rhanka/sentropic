import { join } from 'node:path';
import { kube, req, save, workdir, exportName, triggerName } from './run-core.mjs';
export const policyName = 'sentropic-ci-trigger-suspend-only';
export function neutralize(k = kube) { k(['-n', 'sentropic', 'patch', 'role', triggerName, '--type=merge', '-p', '{"rules":[]}']); }
export function antiRceGate(k = kube) {
  const base = ['--as=system:serviceaccount:sentropic:' + triggerName, '-n', 'sentropic', 'patch', 'cronjob', exportName, '--type=merge', '--dry-run=server', '-p'];
  const a = k([...base, JSON.stringify({ spec: { jobTemplate: { spec: { template: { spec: { containers: [{ name: 'upload', image: 'example.invalid/denied:latest' }] } } } } } })], { allowFailure: true });
  const b = k([...base, '{"spec":{"suspend":false}}'], { allowFailure: true });
  const denied = a.status !== 0 && a.stderr.includes(policyName) && a.stderr.includes('jobTemplate mutation forbidden');
  if (!denied || b.status !== 0) { neutralize(k); throw new Error('anti-RCE gate failed; trigger Role neutralized'); }
  console.log('anti-RCE: jobTemplate denied; suspend allowed');
}
export function secretManifests(env = process.env) {
  const value = key => { const v = env[key]; if (!v || /[\r\n]/.test(v)) throw new Error(`missing or invalid ${key}`); return v; };
  const writer = {
    S3_ACCESS_KEY: value('SENTROPIC_IDP_RELAY_WRITER_S3_ACCESS_KEY'), S3_SECRET_KEY: value('SENTROPIC_IDP_RELAY_WRITER_S3_SECRET_KEY'),
    S3_BUCKET: value('SENTROPIC_IDP_RELAY_S3_BUCKET'), S3_ENDPOINT: value('SENTROPIC_IDP_RELAY_S3_ENDPOINT'), S3_REGION: value('SENTROPIC_IDP_RELAY_S3_REGION'),
  };
  if (writer.S3_BUCKET !== 'sentropic-idp-identity-relay' || writer.S3_ENDPOINT !== 'https://s3.bhs.io.cloud.ovh.net' || writer.S3_REGION !== 'bhs') throw new Error('relay target must match the governed BHS bucket');
  if (!/^[A-Za-z0-9]{16,128}$/.test(writer.S3_ACCESS_KEY) || !/^[A-Za-z0-9/+=]{16,128}$/.test(writer.S3_SECRET_KEY)) throw new Error('invalid relay credential format');
  const password = value('SENTROPIC_IDP_IDENTITY_READER_PG_PASSWORD');
  if (password.length < 16 || password.length > 256) throw new Error('invalid reader password length');
  return [
    ['sentropic-idp-relay-writer', writer],
    ['sentropic-idp-identity-reader', { PGUSER: 'idp_identity_reader', PGPASSWORD: password }],
  ].map(([name, entries]) => ({ apiVersion: 'v1', kind: 'Secret', metadata: { name, namespace: 'sentropic' }, type: 'Opaque', data: Object.fromEntries(Object.entries(entries).map(([key, v]) => [key, Buffer.from(v).toString('base64')])) }));
}
export function replaceSecrets(k = kube, env = process.env) {
  const manifests = secretManifests(env);
  const files = manifests.map(secret => {
    const live = JSON.parse(k(['-n', 'sentropic', 'get', 'secret', secret.metadata.name, '-o', 'json']).stdout);
    secret.metadata.resourceVersion = live.metadata.resourceVersion;
    const name = `${secret.metadata.name}.json`; save(name, JSON.stringify(secret)); return join(workdir(), name);
  });
  for (const file of files) k(['-n', 'sentropic', 'replace', '--dry-run=server', '-f', file, '-o', 'name']);
  for (const file of files) k(['-n', 'sentropic', 'replace', '-f', file, '-o', 'name']);
  console.log('replaced sentropic-idp-relay-writer and sentropic-idp-identity-reader');
}
