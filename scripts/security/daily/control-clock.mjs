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
