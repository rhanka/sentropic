export const OFFSET_BOUND_MS = 250;
export const DIFF_BOUND_MS = 1000;
export const STRATUM_MIN = 1;
export const STRATUM_MAX = 15;
export const REF_AGE_MAX_S = 30;
export const HEALTH_MAX_AGE_MS = 2000;
export const TERMINATE_DETECT_MS = 60000;
export const TERMINATE_TOTAL_MS = 75000;
export const NTS_SERVER = 'time.cloudflare.com';
export const NTS_DAEMON = 'chronyd';
export const NTS_MINPOLL = 4;
export const NTS_MAXPOLL = 4;

export function validateClockHealth(h) {
  const errors = [];
  if (h.ntsAuthenticated !== true) errors.push('NTS source authentication is required');
  if (h.server !== NTS_SERVER) errors.push(`time server must be ${NTS_SERVER}`);
  if (h.daemon !== NTS_DAEMON) errors.push(`daemon must be ${NTS_DAEMON}`);
  if (h.leapState !== 'normal' || h.syncState !== 'synchronized') errors.push('leap and synchronization state must be normal');
  if (!(h.stratum >= STRATUM_MIN && h.stratum <= STRATUM_MAX)) errors.push('stratum must be 1 to 15');
  if (!(h.referenceAgeSeconds <= REF_AGE_MAX_S)) errors.push('reference age must be at most 30 seconds');
  const uncertainty = Math.abs(h.systemOffsetMs ?? NaN) + (h.rootDispersionMs ?? NaN) + (h.rootDelayMs ?? NaN) / 2;
  if (!(uncertainty <= OFFSET_BOUND_MS)) errors.push('offset plus dispersion plus half delay must stay within 250 ms');
  if (!((h.now - h.sampledAt) <= HEALTH_MAX_AGE_MS)) errors.push('health older than two seconds refuses');
  if (h.bootId !== h.baselineBootId) errors.push('boot change fences the session');
  if (!((h.realtimeMinusBoottimeDriftMs ?? NaN) <= 100)) errors.push('realtime-minus-boottime discontinuity above 100 ms fences');
  if (!((h.peerDifferenceMs ?? NaN) <= DIFF_BOUND_MS)) errors.push('watcher and verifier observations above one second refuse');
  return errors;
}

export function terminationVerdict({ detectedAt, terminatedAt }) {
  const elapsed = terminatedAt - detectedAt;
  if (elapsed <= TERMINATE_DETECT_MS) return 'ok';
  if (elapsed <= TERMINATE_TOTAL_MS) return 'exceeded-detect';
  return 'exceeded-total';
}

// r6 §4.3.2 / T5-C6 / T6-C3 — host clock-health and termination bounds: pinned
// chronyd/NTS source, ≤60 s detection / ≤75 s total termination, and direct reads with
// a 2 s GET timeout and 5 s validity.
export const CLOCK_SOURCE = 'chronyd-nts';
export const DETECTION_LIMIT_S = 60;
export const TOTAL_LIMIT_S = 75;
export const DIRECT_READ_GET_TIMEOUT_S = 2;
export const DIRECT_READ_VALIDITY_S = 5;
export const MAX_CLOCK_OFFSET_MS = 1000;

export function assertClockHealth(reading) {
  if (!reading || typeof reading !== 'object') throw new Error('clock-reading-missing');
  if (reading.source !== CLOCK_SOURCE) throw new Error('clock-source');
  if (!Number.isFinite(reading.offsetMs) || Math.abs(reading.offsetMs) > MAX_CLOCK_OFFSET_MS) throw new Error('clock-offset');
  if (!Number.isSafeInteger(reading.epoch)) throw new Error('clock-epoch');
  return true;
}

// Termination timeline: given ordered events [{ atMs, kind }], detection is the first
// 'detected' event after 'drift-start' and total is 'terminated' minus 'drift-start'.
export function assertTerminationTimeline(events) {
  if (!Array.isArray(events) || events.length < 3) throw new Error('timeline-incomplete');
  const start = events.find(e => e.kind === 'drift-start');
  const detected = events.find(e => e.kind === 'detected');
  const terminated = events.find(e => e.kind === 'terminated');
  if (!start || !detected || !terminated) throw new Error('timeline-markers-missing');
  if (detected.atMs < start.atMs || terminated.atMs < detected.atMs) throw new Error('timeline-order');
  const detectionSeconds = (detected.atMs - start.atMs) / 1000;
  const totalSeconds = (terminated.atMs - start.atMs) / 1000;
  if (detectionSeconds > DETECTION_LIMIT_S) throw new Error('detection-over-60s');
  if (totalSeconds > TOTAL_LIMIT_S) throw new Error('termination-over-75s');
  return { detectionSeconds, totalSeconds };
}

export function assertDirectRead(reading) {
  if (!reading || typeof reading !== 'object') throw new Error('direct-read-missing');
  if (reading.getTimeoutSeconds > DIRECT_READ_GET_TIMEOUT_S) throw new Error('direct-read-get-timeout');
  if (reading.validitySeconds > DIRECT_READ_VALIDITY_S) throw new Error('direct-read-validity');
  if (reading.validitySeconds <= 0 || reading.getTimeoutSeconds <= 0) throw new Error('direct-read-nonpositive');
  return true;
}
