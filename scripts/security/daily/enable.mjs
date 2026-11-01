export const PURPOSES = ['deadline-report', 'discovery', 'review', 'manual-merge', 'service-merge'];

export function blankState() {
  const purposes = {};
  for (const purpose of PURPOSES) purposes[purpose] = false;
  return { globalOn: false, epoch: 0, live: [], purposes, holds: [] };
}

export function applyTransaction(state, tx) {
  if (!PURPOSES.includes(tx.enablePurpose)) throw new Error(`unknown purpose ${tx.enablePurpose}`);
  if (typeof tx.epoch !== 'number' || tx.epoch <= state.epoch) throw new Error('epoch must increase');
  if (!tx.terminated || !tx.policyMerged) throw new Error('termination and protected policy merge are required');
  if (!state.globalOn && !tx.globalOffVerified) throw new Error('first enable requires verified global off');
  const missing = state.live.filter((purpose) => !(tx.reverifiedLive ?? []).includes(purpose));
  if (missing.length > 0) throw new Error(`live purposes need reverification: ${missing.join(',')}`);
  const live = [...new Set([...state.live, tx.enablePurpose])];
  const purposes = { ...state.purposes, [tx.enablePurpose]: true };
  return { globalOn: true, epoch: tx.epoch, live, purposes, holds: state.holds };
}

export function applyOff(state, reason) {
  const purposes = {};
  for (const purpose of PURPOSES) purposes[purpose] = false;
  return { globalOn: false, epoch: state.epoch, live: [], purposes, holds: [...state.holds, reason] };
}

export function offPropagation({ boundaries, offObserved }) {
  if (!offObserved) throw new Error('off must be observed before propagation verdict');
  return { blocked: [...boundaries] };
}

export function descendantTermination({ detectedAt, terminatedAt }) {
  const elapsed = terminatedAt - detectedAt;
  if (elapsed <= 60000) return { verdict: 'ok', elapsed };
  return { verdict: 'exceeded-detect', elapsed };
}
