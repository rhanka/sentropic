import { mkdirSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadState, readRecoveryClaim, claimDead } from './t3-lib.mjs';
import { classify } from './t3-window-driver.mjs';
import { preflight } from './t3-preflight-static.mjs';
import { digest } from './guards.mjs';

export function assertRearmState(state, claim, nextOperation) {
  if (state?.step !== 'DONE' || state.commitVerified !== false || claim
    || !nextOperation || nextOperation === state.operationId) throw new Error('rearm_state_invalid');
}

// Explicit action only, after rollback. Evidence is archived before custody is erased.
export function rearm(ctx, nextConfig, read) {
  const state = loadState(ctx.stateDir), config = ctx.config;
  const claim = readRecoveryClaim(ctx.stateDir);
  assertRearmState(state, claim && !claimDead(claim), nextConfig.request.operationId);
  preflight(nextConfig, read);
  if (nextConfig.namespace !== config.namespace || nextConfig.executionSha256 === config.executionSha256
    || nextConfig.request.operationId === config.request.operationId) throw new Error('rearm_inputs_not_fresh');
  const info = classify({ ...ctx, postgresPod: config.postgresPod ?? 'postgres-0' });
  if (info.committed || info.locks !== 0) throw new Error('rearm_database_not_legacy');
  for (const name of ['api', 'auth-idp', 'ui']) {
    const d = JSON.parse(ctx.call(['get', 'deployment', name, '-o', 'json']));
    if (d.spec.replicas !== 1 || d.status?.readyReplicas !== 1
      || d.spec.template.spec.containers.find(c => c.name === name)?.image !== config.legacyImages?.[name]
      || d.spec.template.spec.volumes?.some(v => v.persistentVolumeClaim?.claimName === 'sentropic-a4-custody')) {
      throw new Error('rearm_legacy_not_ready');
    }
  }
  for (const [kind, name] of [['pod', 'sentropic-a4-custodian'], ['secret', 'sentropic-identity-budgets'],
    ['secret', 'auth-idp-session-signing'], ['middleware', 'a4-verification']]) {
    if (ctx.call(['get', kind, name, '--ignore-not-found=true', '-o', 'name']).trim()) throw new Error('rearm_residue');
  }
  const jobs = JSON.parse(ctx.call(['get', 'jobs', '-o', 'json'])).items;
  if (jobs.some(j => j.metadata.name.startsWith('pgbackup-a4-') && j.status?.active)) throw new Error('rearm_backup_active');
  const archive = `${ctx.stateDir}-attempt-${config.request.operationId}`;
  if (existsSync(archive)) throw new Error('rearm_archive_exists');
  mkdirSync(archive, { mode: 0o700 });
  const name = 'sentropic-a4-rearm';
  const pod = { apiVersion: 'v1', kind: 'Pod', metadata: { name, namespace: config.namespace }, spec: {
    restartPolicy: 'Never', automountServiceAccountToken: false,
    containers: [{ name: 'rearm', image: config.images.candidate, command: ['node', '-e', 'setInterval(()=>{},1000)'],
      securityContext: { runAsUser: 0, allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
      volumeMounts: [{ name: 'custody', mountPath: '/run/cm-cutover' }] }],
    volumes: [{ name: 'custody', persistentVolumeClaim: { claimName: 'sentropic-a4-custody' } }] } };
  ctx.call(['create', '-f', '-'], JSON.stringify(pod));
  try {
    ctx.call(['wait', '--for=condition=Ready', `pod/${name}`, '--timeout=30s']);
    const bytes = ctx.call(['exec', name, '--', 'sh', '-ec', 'tar czf - -C /run/cm-cutover . | base64']);
    const data = Buffer.from(bytes.replace(/\s/g, ''), 'base64');
    if (!data.length) throw new Error('rearm_archive_empty');
    writeFileSync(join(archive, 'custody.tar.gz'), data, { mode: 0o600 });
    writeFileSync(join(archive, 'custody.sha256'), digest(data), { mode: 0o600 });
    ctx.call(['exec', name, '--', 'node', '-e', `const fs=require('node:fs');const p='/run/cm-cutover';
      for(const n of fs.readdirSync(p)) fs.rmSync(p+'/'+n,{recursive:true});
      fs.chmodSync(p,0o700);if(fs.readdirSync(p).length)process.exit(1);`]);
  } finally {
    ctx.call(['delete', 'pod', name, '--ignore-not-found=true', '--wait=true', '--timeout=30s']);
  }
  for (const job of jobs.filter(j => j.metadata.name.startsWith('pgbackup-a4-'))) {
    ctx.call(['delete', 'job', job.metadata.name, '--wait=true', '--timeout=30s']);
  }
  renameSync(ctx.stateDir, join(archive, 'operator-state'));
  mkdirSync(ctx.stateDir, { mode: 0o700 });
  return { archive, nextOperation: nextConfig.request.operationId };
}
