import { effectiveTimeout, monoMs, podLabels, probeWithTraefikRetry, recoveryDeadline,
  runKubectl, loadState, saveState, traefikSyncDeadline } from './t3-lib.mjs';
import { canonical, digest } from './guards.mjs';
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

export function normalizePodTemplate(template) {
  if (!template || typeof template !== 'object') return null;
  const copy = structuredClone(template);
  if (copy.metadata && typeof copy.metadata === 'object') {
    delete copy.metadata.creationTimestamp;
    if (copy.metadata.labels && typeof copy.metadata.labels === 'object') {
      delete copy.metadata.labels['pod-template-hash'];
      if (Object.keys(copy.metadata.labels).length === 0) delete copy.metadata.labels;
    }
    if (copy.metadata.annotations && typeof copy.metadata.annotations === 'object'
      && Object.keys(copy.metadata.annotations).length === 0) {
      delete copy.metadata.annotations;
    }
    if (Object.keys(copy.metadata).length === 0) delete copy.metadata;
  }
  return copy;
}

export function templateDigest(template) {
  const normalized = normalizePodTemplate(template);
  return normalized ? digest(canonical(normalized)) : null;
}

function resolveTargetRevision(call, deploy, wantDigest) {
  const list = JSON.parse(call(['get', 'replicasets', '-l', podLabels[deploy], '-o', 'json']) || '{}');
  const matches = (list.items ?? [])
    .filter(rs => {
      const owners = rs.metadata?.ownerReferences;
      if (Array.isArray(owners) && owners.length > 0
        && !owners.some(o => o.kind === 'Deployment' && o.name === deploy)) {
        return false;
      }
      return templateDigest(rs.spec?.template) === wantDigest;
    })
    .map(rs => String(rs.metadata?.annotations?.['deployment.kubernetes.io/revision'] ?? ''))
    .filter(rev => /^[1-9][0-9]*$/.test(rev))
    .sort((a, b) => Number(b) - Number(a));
  if (matches.length === 0) throw new Error(`rollback_template_not_found: ${deploy}`);
  return matches[0];
}

// Pre-commit rollback. Runs only after the classifier proved
// identity_committed=false with zero api pods and zero migration locks.
export async function preCommitRollback(ctx) {
  const { call, probe = null, templateDigests, preCmDir = null, healthUrl = null, jwksUrl = null,
    dryRun = false, note = () => {} } = ctx;
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
    const want = templateDigests?.[deploy];
    if (!want) continue;
    if (dryRun && !ctx.probeReadOnly) {
      note(`# dry-run: ensure deployment/${deploy} matches template digest ${want}`);
      call(['rollout', 'undo', `deployment/${deploy}`]);
      continue;
    }
    const live = JSON.parse(call(['get', 'deployment', deploy, '-o', 'json']) || '{}');
    if (templateDigest(live.spec?.template) === want) continue;
    const targetRevision = resolveTargetRevision(call, deploy, want);
    call(['rollout', 'undo', `deployment/${deploy}`, `--to-revision=${targetRevision}`]);
    const restored = JSON.parse(call(['get', 'deployment', deploy, '-o', 'json']) || '{}');
    if (templateDigest(restored.spec?.template) !== want) {
      throw new Error(`rollback_template_mismatch: ${deploy}`);
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
    templateDigests: JSON.parse(get('--template-digests-json') ?? '{}'), preCmDir: get('--pre-cm-dir'),
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
      const state = process.env.T3_STATE_DIR ? loadState(process.env.T3_STATE_DIR) : null;
      if (state?.templateDigests && config.templateDigests
        && DEPLOYS.some(d => state.templateDigests[d] !== config.templateDigests[d])) {
        throw new Error('rollback_template_digests_mismatch');
      }
      const templateDigests = Object.keys(args.templateDigests).length > 0
        ? args.templateDigests : (state?.templateDigests ?? config.templateDigests ?? {});
      if (args.configFile && !args.dryRun) {
        if (!config.witness?.url || !config.witness?.cookie) throw new Error('rollback_witness_missing');
        if (DEPLOYS.some(d => !/^[a-f0-9]{64}$/.test(String(templateDigests?.[d] ?? '')))) {
          throw new Error('rollback_template_digests_missing');
        }
      }
      const out = await preCommitRollback({ call, templateDigests, preCmDir: args.preCmDir,
        dryRun: args.dryRun, probeReadOnly: args.probeReadOnly, note: console.log, deadlineMs,
        probe: fetch, healthUrl: args.healthUrl, jwksUrl: args.jwksUrl, witness: config.witness });
      if (!args.dryRun && process.env.T3_STATE_DIR) {
        const state = loadState(process.env.T3_STATE_DIR);
        if (state?.commitVerified !== false || state.locks !== 0) throw new Error('rollback_classification_missing');
        Object.assign(state,{ step: 'DONE',watchdogDone: true }); saveState(process.env.T3_STATE_DIR,state);
      }
      if (!args.dryRun) console.log(`rollback_ok removed=${out.removedKeys.join(',') || 'none'}`);
    } catch (err) { console.error(`rollback_failed: ${err.message}`); process.exitCode = 1; }
  }
}
