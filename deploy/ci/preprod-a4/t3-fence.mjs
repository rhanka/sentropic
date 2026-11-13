import { execute } from './execution.mjs';
import { kubectl } from './guards.mjs';
import { loadState, saveState } from './t3-lib.mjs';

// execute validates the entire authorization and annex before invoking its
// first write. Persist intent at that boundary, including uncertain outcomes.
export function fence(env = process.env, call = kubectl) {
  return execute(env, (...args) => {
    const mutating = ['scale', 'patch', 'delete', 'set', 'annotate', 'create'].includes(args[1][0]);
    if (env.A4_DRY_RUN === '0' && mutating) {
      const state = loadState(env.T3_STATE_DIR);
      if (!state || state.step !== 'W1') throw new Error('fence_state_missing');
      state.fenceStarted = true;
      saveState(env.T3_STATE_DIR, state);
    }
    return call(...args);
  });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.stdout.write(fence()); }
  catch { console.error('fence_refused_or_failed'); process.exitCode = 1; }
}
