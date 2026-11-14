import { effectiveTimeout, monoMs, podLabels, probeWithTraefikRetry, recoveryDeadline,
  runKubectl, loadState, saveState, traefikSyncDeadline } from './t3-lib.mjs';
import { t3PriorityClass } from './ops.mjs';
import { readFileSync } from 'node:fs';

// Keys added by the window wire step (fence journal K). Both must be gone and
// verified gone BEFORE any rollout undo or scale-up (Fable M1), or the legacy
// pods boot on the new JWT_SECRET and the witness session can never return.
export const ROTATED_KEYS = ['JWT_SECRET', 'SECRET_ENCRYPTION_KEY'];
const DEPLOYS = ['api', 'auth-idp', 'ui'];

function podsOf(call, component) {
  const out = call(['get', 'pods', '-l', podLabels[component], '-o', 'json']);
  return out ? JSON.parse(out).items ?? [] : [];
}

export function waitZeroPods(call, deadlineMs, components = DEPLOYS, now = monoMs) {
  for (const component of components) {
    while (podsOf(call, component).length > 0) {
      if (now() > deadlineMs) throw new Error(`pods_not_zero: ${component}`);
      if (now === monoMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
  }
}

export function removeRotatedKeys(call, dryRun = false) {
  const secret = JSON.parse(call(['get', 'secret', 'sentropic-api', '-o', 'json']) || '{"data":{}}');
  const present = ROTATED_KEYS.filter(key => secret.data?.[key] !== undefined);
  if (present.length > 0) {
    const patch = present.map(key => ({ op: 'remove', path: `/data/${key}` }));
    call(['patch', 'secret', 'sentropic-api', '--type=json', '-p', JSON.stringify(patch)]);
  } else if (dryRun) {
    // Pure dry-run reads nothing, so the get is empty: still print the exact
    // removal command a real run would issue for both rotated keys.
    const patch = ROTATED_KEYS.map(key => ({ op: 'remove', path: `/data/${key}` }));
    call(['patch', 'secret', 'sentropic-api', '--type=json', '-p', JSON.stringify(patch)]);
  }
  const after = JSON.parse(call(['get', 'secret', 'sentropic-api', '-o', 'json']) || '{"data":{}}');
  const left = ROTATED_KEYS.filter(key => after.data?.[key] !== undefined);
  if (left.length > 0) throw new Error(`keys_not_removed: ${left.join(',')}`);
  call(['delete', 'secret', 'auth-idp-session-signing', '--ignore-not-found=true']);
  call(['delete', 'secret', 'sentropic-identity-budgets', '--ignore-not-found=true']);
  return present;
}

function needsUndo(call, deploy, want, tier) {
  const out = JSON.parse(call(['get', 'deployment', deploy, '-o', 'json']) || '{}');
  const revision = String(out.metadata?.annotations?.['deployment.kubernetes.io/revision'] ?? '');
  const spec = out.spec?.template?.spec;
  return revision !== String(want)
    || (out.metadata?.generation != null && out.status?.observedGeneration != null
      && out.metadata.generation !== out.status.observedGeneration)
    || (tier !== 'restore' && spec?.priorityClassName === t3PriorityClass)
    || Boolean(spec?.volumes?.some(v => ['sentropic-a4-custody', 'auth-idp-session-authority']
      .includes(v.persistentVolumeClaim?.claimName)))
    || Boolean(spec?.containers?.some(c => c.command?.join(' ') === 'node /run/cm-runtime/launch.mjs'));
}

// Pre-commit rollback. Runs only after the classifier proved
// identity_committed=false with zero api pods and zero migration locks.
export async function preCommitRollback(ctx) {
  const { call, probe = null, revisions, preCmDir = null, healthUrl = null, jwksUrl = null,
    dryRun = false, note = () => {}, tier = null } = ctx;
  const clock = ctx.now ?? monoMs;
  for (const deploy of DEPLOYS) call(['scale', `deployment/${deploy}`, '--replicas=0']);
  waitZeroPods(call, Math.min(ctx.deadlineMs ?? Infinity, clock() + (ctx.zeroPodsTimeoutMs ?? 60_000)), DEPLOYS, clock);
  call(['delete', 'pod', 'sentropic-a4-custodian', '--ignore-not-found=true', '--wait=true', '--timeout=60s']);
  const removed = removeRotatedKeys(call, dryRun);
  if (preCmDir) {
    call(['apply', '-f', `${preCmDir}/pre-cm-api.yaml`]);
    call(['apply', '-f', `${preCmDir}/pre-cm-auth-idp.yaml`]);
  }
  for (const deploy of DEPLOYS) {
    const want = revisions?.[deploy];
    if (want && needsUndo(call, deploy, want, tier)) {
      call(['rollout', 'undo', `deployment/${deploy}`, `--to-revision=${want}`]);
    }
  }
  for (const deploy of DEPLOYS) call(['scale', `deployment/${deploy}`, '--replicas=1']);
  for (const deploy of DEPLOYS) call(['rollout', 'status', `deployment/${deploy}`, '--timeout=120s']);
  call(['patch', 'cronjob', 'pgbackup', '--type=merge', '-p', '{"spec":{"suspend":false}}']);
  const exp = JSON.parse(call(['get', 'cronjob', 'sentropic-idp-identity-export', '-o', 'json']) || '{}');
  if (exp.spec?.suspend !== true) {
    if (dryRun) {
      note('# dry-run: identity-export suspension unverified (check live before a real run)');
    } else {
      // Force the guard back on instead of aborting with the Ingress still
      // closed: an exception here must never leave prod fenced.
      call(['patch', 'cronjob', 'sentropic-idp-identity-export', '--type=merge', '-p', '{"spec":{"suspend":true}}']);
      const forced = JSON.parse(call(['get', 'cronjob', 'sentropic-idp-identity-export', '-o', 'json']) || '{}');
      if (forced.spec?.suspend !== true) throw new Error('identity_export_still_running');
    }
  }
  for (const name of ['sentropic', 'auth-idp']) {
    call(['annotate', 'ingress', name, 'traefik.ingress.kubernetes.io/router.middlewares-', '--overwrite']);
  }
  call(['delete', 'middleware', 'a4-verification', '--ignore-not-found=true']);
  if (probe && healthUrl && jwksUrl) await verifyService(probe, ctx);
  effectiveTimeout(1, ctx, (ctx.now ?? monoMs)());
  return { removedKeys: removed };
}

async function verifyService(probe, ctx) {
  const clock = ctx.now ?? monoMs;
  const retryUntilMs = traefikSyncDeadline(ctx, clock);
  const signal = () => AbortSignal.timeout(effectiveTimeout(30_000, ctx, clock()));
  for (const url of [ctx.healthUrl, ctx.jwksUrl]) {
    let res;
    try {
      res = await probeWithTraefikRetry(() => probe(url, { redirect: 'error', signal: signal() }),
        { retryUntilMs, deadlineMs: ctx.deadlineMs, now: clock });
    } catch (err) {
      if (/redirect/i.test(`${err?.message ?? ''} ${err?.cause?.message ?? ''}`)) {
        throw new Error(`rollback_verify_failed: ${url}`);
      }
      throw err;
    }
    await res.body?.cancel?.();
    if (res.status !== 200) throw new Error(`rollback_verify_failed: ${url}`);
  }
  if (ctx.witness) {
    let res;
    try {
      res = await probeWithTraefikRetry(
        () => probe(ctx.witness.url, { redirect: 'error', headers: { cookie: ctx.witness.cookie }, signal: signal() }),
        { retryUntilMs, deadlineMs: ctx.deadlineMs, now: clock });
    } catch (err) {
      if (/redirect/i.test(`${err?.message ?? ''} ${err?.cause?.message ?? ''}`)) {
        throw new Error('rollback_witness_failed');
      }
      throw err;
    }
    await res.body?.cancel?.();
    if (res.status !== 200) throw new Error('rollback_witness_failed');
  }
}

export function cliArgs(argv) {
  const get = name => {
    const i = argv.indexOf(name);
    return i === -1 ? null : argv[i + 1] ?? null;
  };
  return {
    kubeconfig: get('--kubeconfig-file'), namespace: get('--namespace') ?? 'sentropic-preprod',
    revisions: JSON.parse(get('--revisions-json') ?? '{}'), preCmDir: get('--pre-cm-dir'),
    dryRun: argv.includes('--dry-run'), probeReadOnly: argv.includes('--probe-readonly'),
    healthUrl: get('--health-url'), jwksUrl: get('--jwks-url'),
    configFile: get('--config'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = cliArgs(process.argv.slice(2));
  if (!args.kubeconfig) { console.error('usage: t3-rollback.mjs --kubeconfig-file F [--namespace N] ...'); process.exitCode = 1; }
  else {
    const deadlineMs = recoveryDeadline();
    const call = runKubectl({ kubeconfig: args.kubeconfig, namespace: args.namespace, dryRun: args.dryRun,
      probeReadOnly: args.probeReadOnly, print: console.log, timeoutRef: { deadlineMs }, stateDir: process.env.T3_STATE_DIR });
    try {
      const config = args.configFile ? JSON.parse(readFileSync(args.configFile,'utf8')) : {};
      if (args.configFile && !args.dryRun && (!config.witness?.url || !config.witness?.cookie)) {
        throw new Error('rollback_witness_missing');
      }
      const out = await preCommitRollback({ call, revisions: args.revisions, preCmDir: args.preCmDir,
        dryRun: args.dryRun, probeReadOnly: args.probeReadOnly, note: console.log, deadlineMs, tier: config.tier,
        probe: fetch, healthUrl: args.healthUrl, jwksUrl: args.jwksUrl,witness: config.witness });
      if (!args.dryRun && process.env.T3_STATE_DIR) {
        const state = loadState(process.env.T3_STATE_DIR);
        if (state?.commitVerified !== false || state.locks !== 0) throw new Error('rollback_classification_missing');
        Object.assign(state,{ step: 'DONE',watchdogDone: true }); saveState(process.env.T3_STATE_DIR,state);
      }
      if (!args.dryRun) console.log(`rollback_ok removed=${out.removedKeys.join(',') || 'none'}`);
    } catch (err) { console.error(`rollback_failed: ${err.message}`); process.exitCode = 1; }
  }
}
