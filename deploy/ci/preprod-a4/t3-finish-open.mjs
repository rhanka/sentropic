import { createHash } from 'node:crypto';
import { monoMs, podLabels } from './t3-lib.mjs';

// Post-commit convergence, idempotent across restarts (Astra v2 M3).
// States: POSTCOMMIT_RESTRICTED -> ACCEPTED -> BACKUP_RESUMED ->
// ONE_HOST_OPEN -> TWO_HOSTS_OPEN. After ACCEPTED, verify-http is never
// re-invoked (it would fail on a resumed pgbackup); progress is monotonic.
function podsOf(call, component) {
  const out = call(['get', 'pods', '-l', podLabels[component], '-o', 'json']);
  return out ? JSON.parse(out).items ?? [] : [];
}

function deployReady(call, deploy, image) {
  const out = call(['get', 'deployment', deploy, '-o', 'json']);
  if (!out) return false;
  const d = JSON.parse(out);
  const current = d.spec?.template?.spec?.containers?.find(c => c.name === deploy)?.image;
  return d.spec?.replicas === 1 && d.status?.readyReplicas === 1
    && d.status?.observedGeneration === d.metadata?.generation && current === image;
}

function ensureStarted(call, deploy, image) {
  if (deployReady(call, deploy, image)) return;
  const d = JSON.parse(call(['get', 'deployment', deploy, '-o', 'json']));
  const current = d.spec?.template?.spec?.containers?.find(c => c.name === deploy)?.image;
  if (current !== image) call(['set', 'image', `deployment/${deploy}`, `${deploy}=${image}`]);
  call(['scale', `deployment/${deploy}`, '--replicas=1']);
  call(['rollout', 'status', `deployment/${deploy}`, '--timeout=120s']);
  if (!deployReady(call, deploy, image)) throw new Error(`${deploy}_not_ready`);
}

// Repair without ever opening traffic: frontals to zero before touching the
// boundary, middleware patched in place (never create over an existing one,
// which would fail AlreadyExists), annotations re-applied from the W1 record.
export function reconcileRestrictSafe(call, state) {
  const mw = state.middlewareSpec;
  const want = `${state.namespace}-a4-verification@kubernetescrd`;
  const key = 'traefik.ingress.kubernetes.io/router.middlewares';
  let existing = null;
  try {
    const out = call(['get', 'middleware', 'a4-verification', '-o', 'json']);
    existing = out ? JSON.parse(out).spec : null;
  } catch { existing = null; }
  const ingresses = {};
  for (const name of ['sentropic', 'auth-idp']) {
    ingresses[name] = JSON.parse(call(['get', 'ingress', name, '-o', 'json']));
  }
  const conform = existing && JSON.stringify(existing) === JSON.stringify(mw)
    && Object.values(ingresses).every(i => i.metadata?.annotations?.[key] === want);
  if (conform) return;
  for (const component of ['ui', 'auth-idp']) {
    if (podsOf(call, component).length > 0) call(['scale', `deployment/${component}`, '--replicas=0']);
  }
  for (const component of ['ui', 'auth-idp']) {
    if (podsOf(call, component).length > 0) throw new Error(`frontal_not_zero: ${component}`);
  }
  if (!existing) {
    call(['create', '-f', '-'], JSON.stringify({ apiVersion: 'traefik.io/v1alpha1', kind: 'Middleware',
      metadata: { name: 'a4-verification', namespace: state.namespace }, spec: mw }));
  } else if (JSON.stringify(existing) !== JSON.stringify(mw)) {
    call(['patch', 'middleware', 'a4-verification', '--type=merge', '-p', JSON.stringify({ spec: mw })]);
  }
  for (const name of ['sentropic', 'auth-idp']) {
    if (ingresses[name].metadata?.annotations?.[key] !== want) {
      call(['annotate', 'ingress', name, `${key}=${want}`, '--overwrite']);
    }
  }
}

export async function finishOpen(ctx) {
  const { call, probe, state, save, images, probes = [], externalProbes = [] } = ctx;
  if (state.substate === 'POSTCOMMIT_RESTRICTED' || !state.substate) {
    reconcileRestrictSafe(call, state);
    ensureStarted(call, 'ui', images.ui);
    ensureStarted(call, 'auth-idp', images.candidate);
    for (const p of probes) await runProbe(probe, p);
    state.substate = 'ACCEPTED';
    state.acceptedSha256 = createHash('sha256').update(JSON.stringify(probes.map(p => p.id))).digest('hex');
    save(state);
  }
  if (state.substate === 'ACCEPTED') {
    if (!deployReady(call, 'api', images.candidate)) throw new Error('api_not_ready_accepted');
    const pg = JSON.parse(call(['get', 'cronjob', 'pgbackup', '-o', 'json']));
    if (pg.spec?.suspend !== false) {
      call(['patch', 'cronjob', 'pgbackup', '--type=merge', '-p', '{"spec":{"suspend":false}}']);
    }
    state.substate = 'BACKUP_RESUMED';
    state.pgbackupResumed = true;
    save(state);
  }
  if (state.substate === 'BACKUP_RESUMED' || state.substate === 'ONE_HOST_OPEN') {
    const key = 'traefik.ingress.kubernetes.io/router.middlewares-';
    for (const name of ['sentropic', 'auth-idp']) {
      const ing = JSON.parse(call(['get', 'ingress', name, '-o', 'json']));
      if (ing.metadata?.annotations?.['traefik.ingress.kubernetes.io/router.middlewares'] !== undefined) {
        call(['annotate', 'ingress', name, key, '--overwrite']);
        state.openedHosts = [...(state.openedHosts ?? []), name];
        state.substate = 'ONE_HOST_OPEN';
        save(state);
      }
    }
    call(['delete', 'middleware', 'a4-verification', '--ignore-not-found=true']);
    state.substate = 'TWO_HOSTS_OPEN';
    save(state);
  }
  if (state.substate === 'TWO_HOSTS_OPEN') {
    for (const p of externalProbes) await runProbe(probe, p);
  }
  return state;
}

async function runProbe(probe, p) {
  const res = await probe(p.url, { ...p.options, signal: AbortSignal.timeout(p.timeoutMs ?? 5000) });
  await res.body?.cancel?.();
  if (res.status !== p.expect) throw new Error(`probe_failed: ${p.id}`);
}
