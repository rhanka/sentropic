import { preflight } from './t3-preflight-static.mjs';
import { captureAcl, restore } from './t3-restore.mjs';
import { rearm } from './t3-rearm.mjs';
import { privateInput } from './guards.mjs';
import { runKubectl, readRecoveryClaim, claimDead, loadState } from './t3-lib.mjs';

// No default mutation: all maintenance writes require --execute and bound input files.
export async function maintenance(argv = process.argv.slice(2)) {
  const [action, configPath, stateDir] = argv;
  const config = JSON.parse(privateInput(configPath));
  if (action === 'preflight') return preflight(config);
  if (!['capture-acl', 'restore', 'rearm'].includes(action) || !argv.includes('--execute')) {
    throw new Error('maintenance_action_not_explicit');
  }
  const state = loadState(stateDir), claim = readRecoveryClaim(stateDir);
  if (claim && !claimDead(claim)) throw new Error('maintenance_recovery_active');
  for (const pid of [state?.driverPid, state?.watchdogPid]) {
    if (!pid) continue;
    try { process.kill(pid, 0); throw new Error('maintenance_automation_active'); }
    catch (e) { if (e.code !== 'ESRCH') throw e; }
  }
  const call = runKubectl({ kubeconfig: config.kubeconfigFile, namespace: config.namespace });
  const ctx = { config, call, stateDir, probe: fetch };
  if (action === 'capture-acl') return captureAcl(ctx, stateDir);
  if (action === 'restore') return restore(ctx, JSON.parse(privateInput(config.restoreApprovalFile)));
  return rearm(ctx, JSON.parse(privateInput(config.nextConfigFile)));
}
if (import.meta.url === `file://${process.argv[1]}`) {
  try { console.log(JSON.stringify(await maintenance())); }
  catch { console.error('maintenance_refused_or_failed'); process.exitCode = 1; }
}
