import { supervisedAsync, supervisedSync } from './t3-processes.mjs';
import { kubectlProxyEnv } from './t3-kubectl-proxy.mjs';
import { chrono, chronoStart, kubectlClass, monoMs } from './t3-chrono.mjs';
export { monoMs };
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';

// Real pod selectors from deploy/k8s/base/30-api.yaml (B1: never `app=api`,
// which matches nothing and would fake a zero-pod proof).
export const podLabels = {
  api: 'app.kubernetes.io/name=sentropic,app.kubernetes.io/component=api',
  'auth-idp': 'app.kubernetes.io/name=sentropic,app.kubernetes.io/component=auth-idp',
  ui: 'app.kubernetes.io/name=sentropic,app.kubernetes.io/component=ui',
};

const READ_ONLY = new Set(['get', 'auth', 'describe', 'logs', 'top', 'version', 'api-resources', 'kustomize', 'diff']);

export function isReadOnly(args, execIsReadOnly = false) {
  return READ_ONLY.has(args[0])
    || (execIsReadOnly && args[0] === 'exec')
    || (args[0] === 'create' && args.includes('--dry-run=server'));
}

// kubectl runner with a hard timeout (Fable B1: the pilot kills its
// subprocesses on a timer). Dry-run prints mutating commands and runs only
// reads when probeReadOnly is set; plain dry-run executes nothing. In probe
// contexts exec counts as read-only: the driver only ever execs the
// SELECT-only t3-classify.sql through it (statically asserted in tests).
// kubectl exec only forwards stdin to the container with -i; without it
// psql silently reads EOF and returns empty output with status 0.
export function withExecStdin(args, input) {
  return input !== undefined && args[0] === 'exec' ? ['exec', '-i', ...args.slice(1)] : args;
}

export function effectiveTimeout(timeoutMs, timeoutRef, nowMs = monoMs()) {
  const cap = timeoutRef?.deadlineMs != null
    ? timeoutRef.deadlineMs - nowMs
    : Infinity;
  if (cap <= 0) throw new Error('budget_exhausted');
  return Math.min(timeoutMs, cap);
}

// One emergency budget, inherited across every CLI process. Expired windows
// fail closed before any write; restarting an entry point cannot extend it.
export function recoveryDeadline(stateDir = process.env.T3_STATE_DIR) {
  const now = monoMs();
  const state = stateDir ? loadState(stateDir) : null;
  const inherited = process.env.T3_DEADLINE_MONO_MS == null ? Infinity : Number(process.env.T3_DEADLINE_MONO_MS);
  if (Number.isNaN(inherited)) throw new Error('invalid_recovery_deadline');
  const deadlineMs = Math.min(now + 125_000, inherited,
    state?.t0MonoMs == null ? Infinity : state.t0MonoMs + 300_000);
  effectiveTimeout(1, { deadlineMs }, now);
  return deadlineMs;
}

export function runKubectl({ kubeconfig, namespace, timeoutMs = 60_000, dryRun = false, probeReadOnly = false, execIsReadOnly = false, timeoutRef = null, print = () => {}, stateDir = null }) {
  const track = (childPid) => {
    if (!stateDir) return;
    try {
      const cur = loadState(stateDir);
      if (!cur) return;
      cur.childPid = childPid;
      cur.heartbeatMonoMs = cur.heartbeatMonoMs ?? monoMs();
      saveState(stateDir, cur);
    } catch { /* best-effort observability only */ }
  };
  const finishResult = (effective, line, started, result) => {
    track(result?.pid ?? null);
    const timing = chrono(kubectlClass(effective), started, { command: effective.slice(0, 3).join(' '), status: result.status },
      { T3_CHRONO_FILE: process.env.T3_CHRONO_FILE, T3_STATE_DIR: stateDir ?? process.env.T3_STATE_DIR });
    if (probeReadOnly) print(`# ${timing.elapsedMs.toFixed(3)}ms ${line}`);
    if (result.error || result.status !== 0) {
      const err = new Error(`kubectl_failed: ${effective.slice(0, 3).join(' ')}`);
      err.cause = result.error?.message ?? result.stderr?.slice(0, 300);
      throw err;
    }
    return result.stdout;
  };
  const prepare = (args, input) => {
    const effective = withExecStdin(args, input);
    const line = `kubectl --namespace ${namespace} ${effective.join(' ')}`;
    if (dryRun && (!probeReadOnly || !isReadOnly(args, execIsReadOnly))) {
      print(dryRunLine(line, input !== undefined));
      return null;
    }
    track(process.pid);
    return { effective, line, started: chronoStart(),
      argv: ['--kubeconfig', kubeconfig, '--namespace', namespace, '--request-timeout=60s', ...effective] };
  };
  const call = (args, input, overrideMs) => {
    const p = prepare(args, input);
    if (!p) return '';
    return finishResult(p.effective, p.line, p.started, supervisedSync('kubectl', p.argv,
      { input, encoding: 'utf8', env: kubectlProxyEnv(process.env, { kubeconfig }), timeout: effectiveTimeout(overrideMs ?? timeoutMs, timeoutRef), maxBuffer: 32 * 1024 * 1024 }, stateDir));
  };
  call.async = async (args, input, overrideMs, opts = {}) => {
    const p = prepare(args, input);
    if (!p) return '';
    return finishResult(p.effective, p.line, p.started, await supervisedAsync('kubectl', p.argv,
      { input, env: kubectlProxyEnv(process.env, { kubeconfig }), timeout: effectiveTimeout(overrideMs ?? timeoutMs, timeoutRef), maxBuffer: 32 * 1024 * 1024, signal: opts.signal }, stateDir));
  };
  return call;
}

// Exact W8d probe URLs are operator inputs (qualified in P-0.4): the driver
// never invents OAuth scopes or redirect URIs. Shared by the window driver
// and the standalone finish-open CLI so both build the same probes from
// config.endpoints.
export function buildProbes(config) {
  const endpoints = config.endpoints ?? {};
  const probes = [];
  if (endpoints.appHealth) probes.push({ id: 'S-3', url: endpoints.appHealth, expect: 200 });
  if (endpoints.idpConfig) probes.push({ id: 'S-4', url: endpoints.idpConfig, expect: 200,
    issuer: config.expectedIssuer ?? new URL(endpoints.idpConfig).origin });
  if (endpoints.idpJwks) probes.push({ id: 'S-5', url: endpoints.idpJwks, expect: 200, signingKid: config.expectedSigningKid });
  if (endpoints.s6Authorize) probes.push({ id: 'S-6', url: endpoints.s6Authorize, expect: 302, options: { redirect: 'manual' } });
  if (endpoints.appMe) probes.push({ id: 'S-7', url: endpoints.appMe, expect: 401 });
  if (endpoints.idpMe) probes.push({ id: 'S-8', url: endpoints.idpMe, expect: 401 });
  for (const [id, url] of [['S-9a', endpoints.emailApp], ['S-9b', endpoints.emailIdp]]) {
    if (url) probes.push({ id, url, expect: 200, options: { method: 'POST',
      headers: { ...config.emailProbe?.headers, 'content-type': 'application/json', origin: new URL(url).origin },
      body: JSON.stringify({ email: config.emailProbe?.email }) } });
  }
  return { probes, externalProbes: config.externalProbes ?? [],restrictedProbes: config.restrictedProbes ?? [] };
}

// S-1/S-2: a request without the verification credential is refused by Traefik itself, which answers
// basicAuth with 401 and a Basic challenge (the former 403 was the answer of the source-range rule).
export const OBSERVER_REFUSAL = 401;
const isHttpUrl = url => URL.canParse(url) && ['http:', 'https:'].includes(new URL(url).protocol);
export function validateObservers(config) {
  const restricted = [];
  for (const id of ['S-1','S-2']) {
    const p = config?.restrictedProbes?.find(p => p.id === id);
    if (!p || p.expect !== OBSERVER_REFUSAL || !isHttpUrl(p.url)) throw new Error('restricted_observer_missing');
    restricted.push(p);
  }
  if (!Array.isArray(config?.externalProbes) || config.externalProbes.length < 2
    || config.externalProbes.some(p => !isHttpUrl(p.url) || p.expect !== 200)) throw new Error('external_probes_missing');
  const probes = config?.probes ?? (config?.endpoints ? buildProbes(config).probes : []);
  const s3 = probes.find(p => p.id === 'S-3'), s4 = probes.find(p => p.id === 'S-4');
  if (s3 && s4 && isHttpUrl(s3.url) && isHttpUrl(s4.url)) {
    const want = new Set([new URL(s3.url).origin, new URL(s4.url).origin]);
    const got = new Set(restricted.map(p => new URL(p.url).origin));
    if (got.size !== want.size || [...want].some(origin => !got.has(origin))) {
      throw new Error('restricted_observer_origin_mismatch');
    }
    const ext = new Set(config.externalProbes.map(p => new URL(p.url).origin));
    if ([...want].some(origin => !ext.has(origin))) throw new Error('external_observer_origin_mismatch');
  }
}

// Qualified probe paths (plan section 4, corrected by rehearsal r9). The product origin answers
// /api/v1/me and the IdP /api/v1/auth/me; both issue email codes on /api/v1/auth/email/verify-request.
// The earlier literal URLs (/api/v1/auth/me on the product, /api/v1/auth/email/send-code) return 404
// on the candidate: W8 could then never reach ACCEPTED after COMMIT. Refused here, before the fence.
export const PROBE_PATHS = Object.freeze({ 'S-3': '/api/v1/health', 'S-4': '/.well-known/openid-configuration',
  'S-5': '/.well-known/jwks.json', 'S-6': '/api/v1/auth/oauth/authorize', 'S-7': '/api/v1/me',
  'S-8': '/api/v1/auth/me', 'S-9a': '/api/v1/auth/email/verify-request', 'S-9b': '/api/v1/auth/email/verify-request' });
// Product-origin probes, then IdP-origin probes: each group targets one origin.
export const PROBE_ORIGINS = Object.freeze([['S-3', 'S-7', 'S-9a'], ['S-4', 'S-5', 'S-6', 'S-8', 'S-9b']]);

export function validateProbes(probes) {
  const required = { 'S-3': 200, 'S-4': 200, 'S-5': 200, 'S-6': 302,
    'S-7': 401, 'S-8': 401, 'S-9a': 200, 'S-9b': 200 };
  for (const [id, status] of Object.entries(required)) {
    const p = probes.find(p => p.id === id);
    if (!p || p.expect !== status || !URL.canParse(p.url) || !['http:', 'https:'].includes(new URL(p.url).protocol)) {
      throw new Error(`mandatory_probes_missing: ${id}`);
    }
    if (new URL(p.url).pathname !== PROBE_PATHS[id]) throw new Error(`probe_path_unqualified: ${id}`);
    if (id.startsWith('S-9')) {
      let email;
      try { email = JSON.parse(p.options?.body).email; } catch { /* invalid input */ }
      if (p.options?.method !== 'POST' || new Headers(p.options?.headers).get('content-type') !== 'application/json'
        || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        || Buffer.byteLength(email.split('@')[0]) > 36 || Buffer.byteLength(email) > 226) throw new Error(`email_probe_input: ${id}`);
    }
  }
  for (const group of PROBE_ORIGINS) {
    if (new Set(group.map(id => new URL(probes.find(p => p.id === id).url).origin)).size !== 1) {
      throw new Error(`probe_origin_mixed: ${group.join(',')}`);
    }
  }
  if (!probes.find(p => p.id === 'S-5')?.signingKid) throw new Error('signing_kid_missing');
}

function dryRunLine(line, hasInput) {
  return hasInput ? `${line} <redacted-stdin>` : line;
}

export function loadState(dir) {
  try {
    return JSON.parse(readFileSync(`${dir}/t3-window-state.json`, 'utf8'));
  } catch {
    return null;
  }
}

// Atomic 0600 write: tmp file + rename, never a partial state for the watchdog.
export function saveState(dir, state) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${dir}/t3-window-state.json.tmp`;
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  renameSync(tmp, `${dir}/t3-window-state.json`);
}

export function utcNow() {
  return new Date().toISOString();
}

// Single-writer claim for recovery: exactly one of driver/watchdog recovers.
// The lock file holds `owner|monoMs`. Only a dead owner permits takeover.
// Live recovery commands are bounded by the original fence deadline.
export function readRecoveryClaim(dir) {
  try {
    const [owner, at] = readFileSync(`${dir}/t3-recovering.lock`, 'utf8').split('|');
    return { owner, at: Number(at) };
  } catch {
    return null;
  }
}

export function claimRecovery(dir, owner) {
  const path = `${dir}/t3-recovering.lock`;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const fd = openSync(path, 'wx', 0o600);
    writeSync(fd, `${owner}|${monoMs()}`);
    closeSync(fd);
    return true;
  } catch {
    // Single-flight: an existing claim is never re-granted, even to the
    // same owner. A concurrent recover() in the same process must stand
    // down instead of running a second recovery in parallel.
    return false;
  }
}

export function releaseRecovery(dir) {
  try { unlinkSync(`${dir}/t3-recovering.lock`); } catch { /* absent */ }
}

export function claimDead(claim) {
  if (!claim) return true;
  // Elapsed time alone is never proof that the current writer stopped.
  const m = String(claim.owner ?? '').match(/pid-(\d+)$/);
  if (m) {
    try { process.kill(Number(m[1]), 0); return false; }
    catch { return true; }
  }
  return false;
}

// Per-command timeout bounded by the current step's hard cutoff: a kubectl
// or delivered sub-command must never outlive the step that owns it.
export function stepTimeoutMs(requestedMs, deadlineMonoMs, nowMs = monoMs()) {
  return effectiveTimeout(requestedMs, { deadlineMs: deadlineMonoMs }, nowMs);
}

// Traefik v3 EndpointSlice/Ingress/Middleware informers converge asynchronously
// (< 3 s M-6 budget). Retries stay inside existing step/recovery deadlines and
// never retry application JSON errors, redirects or non-Basic 401/403/5xx refusals.
export const TRAEFIK_SYNC_MS = 3_000;
const TRAEFIK_RETRY_DELAY_MS = 50;
const TRAEFIK_MAX_RETRIES = Math.ceil(TRAEFIK_SYNC_MS / TRAEFIK_RETRY_DELAY_MS);

export function traefikSyncDeadline(opts = {}, now = opts?.now ?? monoMs) {
  return Math.min(opts?.deadlineMs ?? Infinity, now() + TRAEFIK_SYNC_MS);
}

function isStaleTraefikResponse(res, expectRefusal) {
  const json = /^application\/json(?:;|$)/i.test(res.headers?.get('content-type') ?? '');
  if (!json && (res.status === 404 || res.status === 502 || res.status === 503)) return true;
  return !expectRefusal && res.status === 401 && /^Basic\b/i.test(res.headers?.get('www-authenticate') ?? '');
}

function isRetryableTransportError(err) {
  if (!err || err.message === 'budget_exhausted') return false;
  return !/redirect/i.test(`${err.message ?? ''} ${err.cause?.message ?? ''}`);
}

export async function probeWithTraefikRetry(send, opts = {}) {
  const now = opts.now ?? monoMs;
  const retryUntilMs = opts.retryUntilMs ?? null;
  for (let retries = 0; ; retries += 1) {
    let res;
    try {
      res = await send();
    } catch (err) {
      if (retryUntilMs == null || retries >= TRAEFIK_MAX_RETRIES
        || !isRetryableTransportError(err) || now() >= retryUntilMs) throw err;
      effectiveTimeout(1, opts, now());
      const waitMs = Math.min(TRAEFIK_RETRY_DELAY_MS, retryUntilMs - now());
      if (waitMs > 0 && now === monoMs) await new Promise(resolve => setTimeout(resolve, waitMs));
      continue;
    }
    if (retryUntilMs != null && retries < TRAEFIK_MAX_RETRIES
      && isStaleTraefikResponse(res, opts.refusal === true) && now() < retryUntilMs) {
      await res.body?.cancel?.();
      effectiveTimeout(1, opts, now());
      const waitMs = Math.min(TRAEFIK_RETRY_DELAY_MS, retryUntilMs - now());
      if (waitMs > 0 && now === monoMs) await new Promise(resolve => setTimeout(resolve, waitMs));
      continue;
    }
    return res;
  }
}
