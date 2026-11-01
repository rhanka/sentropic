export const CAPS = {
  promotions: (n) => 31 * n,
  stateTransactions: 1024,
  prCampaigns: (r) => 2 * r + 6,
  merges: (r) => r + 6,
  prCiJobs: 128,
  releaseJobs: 128,
  qualification: 4096,
};

export function baselineJobs(n) {
  return 1922 * n + 496;
}

export function promotionJobs(pc, ps) {
  return 3 * (pc + ps);
}

export function stateJobs(t) {
  return 16 * t;
}

export function bridgeJobs(h) {
  return 8 * h;
}

export function mergeJobs(m) {
  return 8 * m;
}

export function admit({ used, requested, cap, retry, reserved }) {
  if (typeof used !== 'number' || typeof requested !== 'number' || typeof cap !== 'number') {
    return { allowed: false, reason: 'unknown counts refuse' };
  }
  if (retry && !reserved) return { allowed: false, reason: 'undeclared retry refuses' };
  if (used + requested > cap) return { allowed: false, reason: 'cap reached, one more refuses' };
  return { allowed: true, reason: 'within reservation' };
}
