import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
export const credentialName = 'KUBE_CONFIG_DATA_PREPROD_BASCULE';
export const preprod = 'sentropic-preprod';
export function access(root) {
  const match = readFileSync(join(root, '.env'), 'utf8').match(new RegExp(`^${credentialName}=(.*)$`, 'm'));
  let value = process.env[credentialName] || match?.[1]?.trim();
  if (!value) throw new Error(`missing ${credentialName}`);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  const directory = mkdtempSync(join(tmpdir(), 'gb4-kube-'));
  const file = join(directory, 'config');
  const contents = value.startsWith('apiVersion:') ? value.replace(/\\n/g, '\n') : Buffer.from(value, 'base64');
  writeFileSync(file, contents, { mode: 0o600 });
  const env = { ...process.env, KUBECONFIG: file };
  delete env[credentialName];
  const kube = (args, input) => {
    const result = spawnSync('kubectl', ['--request-timeout=20s', ...args], { env, input, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
    // Never forward kubectl diagnostics: malformed access material may be echoed.
    if (result.status !== 0) throw new Error(`kubectl ${args[0]} failed (exit ${result.status ?? 'timeout'})`);
    return result.stdout.trim();
  };
  try {
    const current = kube(['config', 'view', '--minify', '-o', 'jsonpath={.contexts[0].context.namespace}']);
    if (current !== preprod) throw new Error('kube context must select sentropic-preprod');
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
  return { kube, close: () => rmSync(directory, { recursive: true, force: true }) };
}
export function liveInputs(kube) {
  const pods = JSON.parse(kube(['get', 'pods', '-n', preprod, '-o', 'json'])).items;
  const ready = pods.filter((pod) => pod.status.phase === 'Running' && pod.status.conditions?.some((c) => c.type === 'Ready' && c.status === 'True'));
  const component = (pod) => pod.metadata.labels?.['app.kubernetes.io/component'];
  const allowed = ready.find((pod) => component(pod) === 'artifact-content');
  const forbidden = ready.find((pod) => ['api', 'auth-idp'].includes(component(pod)));
  if (!allowed || !forbidden) throw new Error('ready artifact-content and non-content Node pods required');
  const container = (pod) => pod.spec.containers.find((c) => c.name === component(pod))?.name;
  if (!container(allowed) || !container(forbidden)) throw new Error('matching Node containers required');
  const services = JSON.parse(kube(['get', 'services', '-n', preprod, '-o', 'json'])).items;
  const targets = [];
  for (const svc of services.filter((s) => ['postgres', 'api', 'auth-idp'].includes(s.metadata.name))) {
    if (!svc.spec.clusterIP || svc.spec.clusterIP === 'None') continue;
    const endpoints = JSON.parse(kube(['get', 'endpoints', svc.metadata.name, '-n', preprod, '-o', 'json']));
    const port = svc.spec.ports.find((p) => p.protocol === 'TCP' && endpoints.subsets?.some((s) => s.addresses?.length && s.ports?.some((ep) => ep.name === p.name)));
    if (port) targets.push([`${svc.metadata.name}.${preprod}`, svc.spec.clusterIP, port.port]);
  }
  if (targets.length < 2) throw new Error('two live cluster services with ready endpoints required');
  return { allowed, forbidden, container, targets };
}
