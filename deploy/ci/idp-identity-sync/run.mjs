import { readFileSync, appendFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { kube, configure, req, render, validateRun, waitJob, applyJob, exportSnapshot, flip, workdir, exportName, failureSummary } from './run-core.mjs';
import { replaceSecrets, antiRceGate, neutralize } from './bundle-cd.mjs';
const template = name => readFileSync(new URL(name, import.meta.url), 'utf8');
export function auditSummary(raw, expectedOutcome) {
  const value = JSON.parse(raw);
  const keys = ['synced_users', 'synced_webauthn', 'rekeyed', 'preprod_only_kept', 'post_users', 'post_webauthn', 'rekey_dropped_sessions', 'rekey_moved_webauthn', 'consents_upserted', 'consents_removed'];
  if (value.outcome !== expectedOutcome || keys.some(k => !Number.isSafeInteger(value[k]) || value[k] < 0) || !Array.isArray(value.rekey_pairs) || value.rekey_pairs.length !== value.rekeyed) throw new Error('invalid import audit');
  if (value.rekey_pairs.some(pair => !/^[a-f0-9-]{36}$/.test(pair.old_id) || !/^[a-f0-9-]{36}$/.test(pair.new_id))) throw new Error('invalid audit rekey IDs');
  return { outcome: value.outcome, ...Object.fromEntries(keys.map(k => [k, value[k]])), rekey_pairs: value.rekey_pairs.map(p => ({ old_id: p.old_id, new_id: p.new_id })) };
}
export function collectAudit(name, expectedOutcome, k = kube) {
  const logs = k(['-n', 'sentropic-preprod', 'logs', `job/${name}`, '-c', 'import-preprod'], { allowFailure: true });
  const pods = JSON.parse(k(['-n', 'sentropic-preprod', 'get', 'pods', '-l', `job-name=${name}`, '-o', 'json']).stdout).items;
  const messages = pods.flatMap(p => p.status?.containerStatuses ?? []).filter(c => c.name === 'import-preprod').map(c => c.state?.terminated?.message).filter(Boolean);
  const summaries = [...logs.stdout.split('\n').filter(l => l.startsWith('{')), ...messages].map(m => auditSummary(m, expectedOutcome));
  if (!summaries.length) throw new Error('import termination audit unavailable');
  const json = JSON.stringify(summaries.at(-1)); console.log(json);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### IdP sync job/${name}\n\n\`\`\`json\n${json}\n\`\`\`\n`);
  return summaries.at(-1);
}
export function failureVerdict(name, k = kube) {
  try {
    const pods = JSON.parse(k(['-n', 'sentropic-preprod', 'get', 'pods', '-l', `job-name=${name}`, '-o', 'json']).stdout).items;
    const messages = pods.flatMap(p => p.status?.containerStatuses ?? []).filter(c => c.name === 'import-preprod').map(c => c.state?.terminated?.message).filter(Boolean);
    if (!messages.length) throw new Error();
    const failure = failureSummary(messages.at(-1));
    const pairs = failure.rejected_rekey_pairs ?? [];
    return `job/${name} failed: ${failure.code}${pairs.length ? ` (${pairs.join(',')})` : ''}`;
  } catch { throw new Error(`job/${name} failed: termination failure code unavailable`); }
}
export async function main(action = process.argv[2]) {
  switch (action) {
    case 'validate': validateRun(); console.log('run inputs accepted'); return;
    case 'configure': configure(process.argv[3]); return;
    case 'export': validateRun(); await exportSnapshot(); return;
    case 'resuspend': flip(true); return;
    case 'bundle': {
      replaceSecrets();
      try {
        kube(['apply', '-k', 'deploy/k8s/overlays/prod/idp-identity-sync']);
        const cj = JSON.parse(kube(['-n', 'sentropic', 'get', 'cronjob', exportName, '-o', 'json']).stdout);
        if (cj.spec.suspend !== true) throw new Error('applied export CronJob is not dormant');
        const name = 'sentropic-idp-reader-role-provision';
        applyJob('sentropic', name, template('reader-role-provision-job.tmpl.yaml'));
        if (await waitJob('sentropic', name, 300) !== 'complete') throw new Error('reader provisioning failed');
        antiRceGate();
      } catch (error) { neutralize(); throw error; }
      return;
    }
    case 'import': {
      const inputs = validateRun();
      const suffix = req('GITHUB_RUN_ID') + '-' + req('GITHUB_RUN_ATTEMPT');
      if (!/^[0-9]+-[0-9]+$/.test(suffix)) throw new Error('invalid run ID');
      const name = `sentropic-idp-sync-${suffix}`;
      if (name.length > 63) throw new Error('Job name too long');
      applyJob('sentropic-preprod', name, render(template('import-job.tmpl.yaml'), { ...inputs, JOB_NAME: name }));
      const verdict = await waitJob('sentropic-preprod', name, 900);
      if (verdict === 'failed') throw new Error(failureVerdict(name));
      if (verdict !== 'complete') throw new Error(`job/${name} failed`);
      try { collectAudit(name, inputs.DRY_RUN === '1' ? 'rolled_back' : 'committed'); }
      catch (error) { console.log(`job/${name}: audit unavailable`); throw error; }
      return;
    }
    case 'cleanup': rmSync(workdir(), { recursive: true, force: true }); return;
    default: throw new Error('unknown idp-sync action');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
