import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
export const exportName = 'sentropic-idp-identity-export';
export const triggerName = 'sentropic-ci-trigger-idp-export';
export const workdir = () => process.env.IDP_SYNC_WORKDIR || join(process.env.RUNNER_TEMP || '/tmp', 'idp-identity-sync');
export function req(name) { const value = process.env[name]; if (!value) throw new Error(`missing ${name}`); return value; }
export function save(name, value) { mkdirSync(workdir(), { recursive: true, mode: 0o700 }); writeFileSync(join(workdir(), name), value, { mode: 0o600 }); }
export const read = name => readFileSync(join(workdir(), name), 'utf8');
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function kube(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('kubectl', ['--kubeconfig', join(workdir(), 'kubeconfig'), ...args], { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0 && !allowFailure) throw new Error(`kubectl ${args[0]} failed (details withheld)`);
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}
export function configure(tier, k = kube) {
  const raw = req('KUBE_CONFIG_DATA');
  const decoded = Buffer.from(raw, 'base64').toString('utf8');
  save('kubeconfig', decoded.startsWith('apiVersion:') ? decoded : raw);
  if (tier === 'prod') {
    const cluster = JSON.parse(k(['config', 'view', '--minify', '-o', 'json']).stdout).clusters?.[0]?.cluster;
    if (!cluster || new URL(cluster.server).hostname !== req('EXPECTED_KUBE_APISERVER_HOST_PROD')) throw new Error('prod apiserver host mismatch');
  } else if (tier !== 'preprod') throw new Error('invalid tier');
}
export function render(template, values) {
  const result = template.replace(/\$\{([A-Z_]+)\}/g, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`missing template value ${name}`);
    return JSON.stringify(String(values[name])).slice(1, -1);
  });
  if (/\$\{/.test(result)) throw new Error('unresolved template placeholder');
  return result;
}
export function classifyJobStatus(status = {}) {
  const conditions = status?.conditions ?? [];
  if (Number(status?.failed) > 0 || conditions.some(c => c.type === 'Failed' && c.status === 'True')) return 'failed';
  if (Number(status?.succeeded) > 0 || conditions.some(c => c.type === 'Complete' && c.status === 'True')) return 'complete';
  return Number(status?.active) > 0 ? 'active' : 'pending';
}
export function failureSummary(raw) {
  const codes = ['invalid_dry_run', 'invalid_age_limit', 'invalid_manifest', 'integrity_failed', 'invalid_counts', 'invalid_timestamp', 'stale_snapshot', 'rekey_not_allowed', 'manifest_mismatch', 'empty_export', 'dv5_invariant_changed', 'postcondition_failed', 'lock_timeout', 'sql_error', 'invalid_audit', 'consent_client_missing', 'consent_postcondition_failed'];
  const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
  try {
    const value = JSON.parse(raw);
    if (!value || value.outcome !== 'failed' || !codes.includes(value.code) || Object.keys(value).some(k => !['outcome', 'code', 'rejected_rekey_pairs'].includes(k))) throw new Error();
    if (value.code === 'rekey_not_allowed') {
      if (!Array.isArray(value.rejected_rekey_pairs) || value.rejected_rekey_pairs.some(p => typeof p !== 'string' || !new RegExp(`^${uuid}>${uuid}$`).test(p))) throw new Error();
      return { outcome: 'failed', code: value.code, rejected_rekey_pairs: [...value.rejected_rekey_pairs] };
    }
    if (Object.hasOwn(value, 'rejected_rekey_pairs')) throw new Error();
    return { outcome: 'failed', code: value.code };
  } catch { throw new Error('invalid import failure message'); }
}
export function validateRun(env = process.env, now = new Date()) {
  if (env.GITHUB_REF !== 'refs/heads/main') throw new Error('identity sync runs require main');
  const scheduled = env.GITHUB_EVENT_NAME === 'schedule';
  const dryRun = scheduled ? '0' : env.DRY_RUN;
  if (!['0', '1'].includes(dryRun)) throw new Error('DRY_RUN must be 0 or 1');
  const allowedRekey = scheduled ? '' : (env.ALLOWED_REKEY || '').trim();
  const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
  if (allowedRekey && !allowedRekey.split(',').every(pair => new RegExp(`^${uuid}>${uuid}$`).test(pair.trim()))) throw new Error('invalid ALLOWED_REKEY format');
  if (!scheduled && dryRun === '0' && env.CONFIRM !== `idp-sync-${now.toISOString().slice(0, 10)}`) throw new Error('real run requires today\'s CONFIRM');
  const maxAge = env.MAX_SNAPSHOT_AGE_S || '7200';
  if (!/^[1-9][0-9]*$/.test(maxAge) || Number(maxAge) > 86400) throw new Error('invalid MAX_SNAPSHOT_AGE_S');
  return { DRY_RUN: dryRun, ALLOWED_REKEY: allowedRekey, MAX_SNAPSHOT_AGE_S: maxAge };
}
export async function waitJob(namespace, name, timeoutSeconds, k = kube, delay = sleep) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  do {
    const status = classifyJobStatus(JSON.parse(k(['-n', namespace, 'get', 'job', name, '-o', 'json']).stdout).status);
    if (status === 'complete' || status === 'failed') return status;
    await delay(5000);
  } while (Date.now() < deadline);
  throw new Error(`job/${name} timed out`);
}
export function applyJob(namespace, name, manifest, k = kube) {
  k(['-n', namespace, 'delete', 'job', name, '--ignore-not-found', '--wait=true']);
  k(['-n', namespace, 'apply', '-f', '-'], { input: manifest });
}
export function flip(suspend, k = kube) {
  k(['-n', 'sentropic', 'patch', 'cronjob', exportName, '--type=merge', '-p', JSON.stringify({ spec: { suspend } })]);
}
export async function exportSnapshot(k = kube, delay = sleep) {
  const cj = JSON.parse(k(['-n', 'sentropic', 'get', 'cronjob', exportName, '-o', 'json']).stdout);
  if (cj.spec.suspend !== true) throw new Error('export CronJob must initially be suspended');
  const owned = () => JSON.parse(k(['-n', 'sentropic', 'get', 'jobs', '-o', 'json']).stdout).items.filter(j => j.metadata.ownerReferences?.some(o => o.uid === cj.metadata.uid));
  const old = owned();
  if (old.some(j => ['active', 'pending'].includes(classifyJobStatus(j.status)))) throw new Error('previous export still in progress');
  const prior = new Set(old.map(j => j.metadata.uid));
  const deadline = Date.now() + 720000;
  try {
    flip(false, k);
    do {
      const job = owned().find(j => !prior.has(j.metadata.uid));
      if (job) {
        const verdict = await waitJob('sentropic', job.metadata.name, 600, k, delay);
        if (verdict !== 'complete') throw new Error('prod export Job failed');
        const pods = JSON.parse(k(['-n', 'sentropic', 'get', 'pods', '-l', `job-name=${job.metadata.name}`, '-o', 'json']).stdout).items;
        const message = pods.flatMap(p => p.status?.initContainerStatuses ?? []).find(c => c.name === 'export')?.state?.terminated?.message;
        const counts = JSON.parse(message || '{}');
        if (!Number.isInteger(counts.users) || counts.users <= 0 || !Number.isInteger(counts.webauthn) || counts.webauthn < 0 || !Number.isSafeInteger(counts.consents) || counts.consents < 0) throw new Error('invalid export termination verdict');
        console.log(`export users=${counts.users} webauthn=${counts.webauthn} consents=${counts.consents}`);
        return job.metadata.name;
      }
      await delay(5000);
    } while (Date.now() < deadline);
    throw new Error('no export Job appeared before deadline');
  } finally { flip(true, k); }
}
