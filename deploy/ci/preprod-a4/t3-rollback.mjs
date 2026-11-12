import { monoMs, podLabels, runKubectl } from './t3-lib.mjs';

// Keys added by the window wire step (fence journal K). Both must be gone and
// verified gone BEFORE any rollout undo or scale-up (Fable M1), or the legacy
// pods boot on the new JWT_SECRET and the witness session can never return.
export const ROTATED_KEYS = ['JWT_SECRET', 'SECRET_ENCRYPTION_KEY'];
const DEPLOYS = ['api', 'auth-idp', 'ui'];

function podsOf(call, component) {
  const out = call(['get', 'pods', '-l', podLabels[component], '-o', 'json']);
  return out ? JSON.parse(out).items ?? [] : [];
}

export function waitZeroPods(call, deadlineMs, components = DEPLOYS) {
  for (const component of components) {
    while (podsOf(call, component).length > 0) {
      if (monoMs() > deadlineMs) throw new Error(`pods_not_zero: ${component}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
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

function revisionOf(call, deploy) {
  const out = JSON.parse(call(['get', 'deployment', deploy, '-o', 'json']) || '{}');
  return String(out.metadata?.annotations?.['deployment.kubernetes.io/revision'] ?? '');
}

// Pre-commit rollback. Runs only after the classifier proved
// identity_committed=false with zero api pods and zero migration locks.
export function preCommitRollback(ctx) {
  const { call, probe = null, revisions, preCmDir = null, healthUrl = null, jwksUrl = null,
    dryRun = false, note = () => {} } = ctx;
  for (const deploy of DEPLOYS) call(['scale', `deployment/${deploy}`, '--replicas=0']);
  waitZeroPods(call, monoMs() + (ctx.zeroPodsTimeoutMs ?? 60_000));
  call(['delete', 'pod', 'sentropic-a4-custodian', '--ignore-not-found=true', '--wait=true', '--timeout=60s']);
  const removed = removeRotatedKeys(call, dryRun);
  if (preCmDir) {
    call(['apply', '-f', `${preCmDir}/pre-cm-api.yaml`]);
    call(['apply', '-f', `${preCmDir}/pre-cm-auth-idp.yaml`]);
  }
  for (const deploy of DEPLOYS) {
    const want = revisions?.[deploy];
    if (want && revisionOf(call, deploy) !== String(want)) {
      call(['rollout', 'undo', `deployment/${deploy}`, `--to-revision=${want}`]);
    }
  }
  for (const deploy of DEPLOYS) call(['scale', `deployment/${deploy}`, '--replicas=1']);
  for (const deploy of DEPLOYS) call(['rollout', 'status', `deployment/${deploy}`, '--timeout=120s']);
  call(['patch', 'cronjob', 'pgbackup', '--type=merge', '-p', '{"spec":{"suspend":false}}']);
  const exp = JSON.parse(call(['get', 'cronjob', 'sentropic-idp-identity-export', '-o', 'json']) || '{}');
  if (exp.spec?.suspend !== true) {
    if (dryRun) note('# dry-run: identity-export suspension unverified (check live before a real run)');
    else throw new Error('identity_export_must_stay_suspended');
  }
  for (const name of ['sentropic', 'auth-idp']) {
    call(['annotate', 'ingress', name, 'traefik.ingress.kubernetes.io/router.middlewares-', '--overwrite']);
  }
  call(['delete', 'middleware', 'a4-verification', '--ignore-not-found=true']);
  if (probe && healthUrl && jwksUrl) verifyService(probe, ctx);
  return { removedKeys: removed };
}

async function verifyService(probe, ctx) {
  for (const url of [ctx.healthUrl, ctx.jwksUrl]) {
    const res = await probe(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    await res.body?.cancel?.();
    if (res.status !== 200) throw new Error(`rollback_verify_failed: ${url}`);
  }
  if (ctx.witness) {
    const res = await probe(ctx.witness.url, { headers: { cookie: ctx.witness.cookie }, signal: AbortSignal.timeout(30_000) });
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
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = cliArgs(process.argv.slice(2));
  if (!args.kubeconfig) { console.error('usage: t3-rollback.mjs --kubeconfig-file F [--namespace N] ...'); process.exitCode = 1; }
  else {
    const call = runKubectl({ kubeconfig: args.kubeconfig, namespace: args.namespace, dryRun: args.dryRun, probeReadOnly: args.probeReadOnly, print: console.log });
    try {
      const out = preCommitRollback({ call, revisions: args.revisions, preCmDir: args.preCmDir,
        dryRun: args.dryRun, probeReadOnly: args.probeReadOnly, note: console.log });
      if (!args.dryRun) console.log(`rollback_ok removed=${out.removedKeys.join(',') || 'none'}`);
    } catch (err) { console.error(`rollback_failed: ${err.message}`); process.exitCode = 1; }
  }
}
