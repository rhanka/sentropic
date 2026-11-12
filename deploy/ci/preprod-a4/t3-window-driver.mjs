import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { monoMs, runKubectl, loadState, saveState, utcNow } from './t3-lib.mjs';
import { preCommitRollback } from './t3-rollback.mjs';
import { finishOpen } from './t3-finish-open.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOTAL_BUDGET_MS = 300_000;
const COMMIT_CUTOFF_MS = 175_000;
const FINISH_CUTOFF_MS = 205_000;
export const COMMIT_MARKER = 1793577600000;

// RBAC matrix, 50 (resource, verb) couples from the executed command set.
export const RBAC_MATRIX = [
  ['deployments', ['get', 'list', 'watch', 'patch', 'update']],
  ['deployments/scale', ['get', 'patch', 'update']],
  ['replicasets', ['get', 'list', 'patch']],
  ['statefulsets', ['get', 'list']],
  ['daemonsets', ['get', 'list']],
  ['pods', ['get', 'list', 'watch', 'create', 'delete']],
  ['pods/log', ['get']],
  ['pods/exec', ['create', 'get']],
  ['jobs', ['get', 'list', 'watch', 'create', 'delete']],
  ['cronjobs', ['get', 'list', 'patch']],
  ['configmaps', ['get', 'create', 'patch', 'update']],
  ['secrets', ['get', 'create', 'patch', 'delete']],
  ['persistentvolumeclaims', ['get', 'create', 'patch']],
  ['ingresses.networking.k8s.io', ['get', 'patch']],
  ['endpointslices.discovery.k8s.io', ['get', 'list']],
  ['middlewares.traefik.io', ['get', 'create', 'patch', 'delete']],
];
export const RBAC_COUNT = RBAC_MATRIX.reduce((n, [, verbs]) => n + verbs.length, 0);

export function loadSql(name) {
  return readFileSync(join(HERE, name), 'utf8');
}

export function hashRows(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function splitSql(text) {
  const parts = {};
  let current = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^-- (Q[1-6]):/);
    if (m) { current = m[1]; parts[current] = ''; continue; }
    if (current && !line.startsWith('--')) parts[current] += `${line}\n`;
  }
  return parts;
}

// One delivered A4 entry point (execution.mjs / ops.mjs / run.mjs / verify.mjs)
// with file-path-only env, never secret values in argv.
export function delivered(ctx, script, env, timeoutMs) {
  const flat = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ');
  if (ctx.dryRun) { ctx.print(`# dry-run: ${flat} node ${script}`); return ''; }
  const res = spawnSync('node', [join(HERE, script)],
    { env: { ...process.env, ...env }, encoding: 'utf8', timeout: timeoutMs });
  if (res.error || res.status !== 0) {
    throw new Error(`delivered_failed: ${script} ${(res.stderr ?? '').slice(0, 200)}`);
  }
  return res.stdout;
}

export function psql(ctx, statement, timeoutMs = 30_000) {
  if (ctx.dryRun && !ctx.probeReadOnly) {
    ctx.print(`# dry-run sql: ${statement.split('\n')[0]}...`);
    return '';
  }
  const started = monoMs();
  const out = ctx.call(['exec', ctx.postgresPod, '--',
    'psql', '-v', 'ON_ERROR_STOP=1', '-X', '-qAt'], statement);
  if (ctx.probeReadOnly) ctx.print(`# ${(monoMs() - started)}ms psql ${statement.split('\n')[0]}...`);
  return out;
}

// Classification: two cheap read-only round trips, no static reference to an
// optional relation (B2). Branch P needs committed AND apiReady; else U.
export function classify(ctx) {
  const sql = splitSql(loadSql('t3-classify.sql'));
  const q1 = psql(ctx, sql.Q1).trim().split('|');
  const journal = q1[0] === 't';
  const locks = Number(q1[1] ?? 0);
  let committed = false, receipts = 0;
  if (journal) {
    committed = psql(ctx, sql.Q2).trim() === 't';
    const hasAssetCol = psql(ctx, sql.Q3).trim() === 't';
    if (hasAssetCol) receipts = Number(psql(ctx, sql.Q4).trim() || 0);
  }
  let apiReady = false;
  try {
    const d = JSON.parse(ctx.call(['get', 'deployment', 'api', '-o', 'json']));
    const img = d.spec?.template?.spec?.containers?.find(c => c.name === 'api')?.image;
    apiReady = d.spec?.replicas === 1 && d.status?.readyReplicas === 1
      && d.status?.observedGeneration === d.metadata?.generation && img === ctx.config.candidateImage;
  } catch { apiReady = false; }
  return { journal, locks, committed, receipts, apiReady };
}

export function checkRbac(ctx) {
  for (const [resource, verbs] of RBAC_MATRIX) {
    for (const verb of verbs) {
      const out = ctx.call(['auth', 'can-i', verb, resource]);
      if (String(out).trim() !== 'yes') throw new Error(`rbac_denied: ${verb} ${resource}`);
    }
  }
}
