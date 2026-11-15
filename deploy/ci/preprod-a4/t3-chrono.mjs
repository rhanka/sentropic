import { appendFileSync, readFileSync } from 'node:fs';

// Monotonic milliseconds shared by driver and watchdog. CLOCK_BOOTTIME via
// /proc/uptime is immune to NTP steps; Date.now is log-only, never budget.
// Number() ignores the process locale: a comma-decimal LC_NUMERIC cannot truncate it.
export function monoMs() {
  try {
    const first = readFileSync('/proc/uptime', 'utf8').trim().split(/\s+/)[0];
    const seconds = Number(first);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000);
  } catch { /* fall through to wall clock (tests, non-Linux) */ }
  return Date.now();
}

// Operator thresholds of the M-1 and M-4 campaigns (plan section 7), in milliseconds.
export const THRESHOLDS_MS = { custodyAttach: 10_000, custodyDetach: 6_000, kubectlRoundTrip: 1_200 };

export const chronoStart = () => process.hrtime.bigint();
// Start of a span that began `ms` monotonic milliseconds ago; a malformed figure never throws.
export const chronoSince = ms => chronoStart() - BigInt(Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0) * 1_000_000n;

// Waits, rollouts, blocking deletions and exec payloads are bounded elsewhere; only a plain
// API request is a round trip in the sense of M-4.
export function kubectlClass(args) {
  if (args[0] === 'exec') return 'kubectlExec';
  return ['wait', 'rollout'].includes(args[0]) || (args[0] === 'delete' && args.includes('--wait=true'))
    ? 'kubectlWait' : 'kubectlRoundTrip';
}

// One chronometer for every driver entry point: nanosecond source, millisecond figures with
// three decimals, appended as protected JSON lines. Recording never fails the cutover.
export function chrono(name, startNs, extra = {}, env = process.env) {
  const elapsedMs = Number((process.hrtime.bigint() - startNs) / 1000n) / 1000;
  const record = { name, atMonoMs: monoMs(), elapsedMs, ...extra };
  const file = env.T3_CHRONO_FILE || (env.T3_STATE_DIR ? `${env.T3_STATE_DIR}/t3-chrono.jsonl` : '');
  if (file) {
    try { appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 }); } catch { /* observability only */ }
  }
  return record;
}

export function summarize(text) {
  const groups = {};
  let proxyConnects = 0;
  for (const line of text.split('\n').filter(Boolean)) {
    const rec = JSON.parse(line), { name, elapsedMs } = rec;
    if (typeof name !== 'string' || !Number.isFinite(elapsedMs)) throw new Error('chrono_record_invalid');
    if (Number.isFinite(rec.proxyConnects)) proxyConnects += rec.proxyConnects;
    const group = groups[name] ??= { count: 0, maxMs: 0 };
    group.count += 1;
    group.maxMs = Math.max(group.maxMs, elapsedMs);
  }
  for (const [name, thresholdMs] of Object.entries(THRESHOLDS_MS)) {
    if (groups[name]) Object.assign(groups[name], { thresholdMs, pass: groups[name].maxMs <= thresholdMs });
  }
  return { version: 't3-chrono/1', groups, proxyConnects, pass: Object.values(groups).every(group => group.pass !== false) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const summary = summarize(readFileSync(process.argv[2], 'utf8'));
    console.log(JSON.stringify(summary));
    if (!summary.pass) process.exitCode = 1;
  } catch { console.error('chrono_summary_refused'); process.exitCode = 1; }
}
